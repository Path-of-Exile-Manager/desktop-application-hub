//! Following a growing text file: `Client.txt` reaches gigabytes, so only what is appended after
//! the file was opened is read.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// At most this much is read by one [`Tail::poll`]; the rest waits for the next call.
const MAX_READ: u64 = 8 * 1024 * 1024;
/// A "line" longer than this without a line break is not a log line: it is dropped.
const MAX_LINE: usize = 1024 * 1024;

/// Where reading starts when the file is first opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Start {
    /// From the end: only lines written from now on (the normal mode).
    End,
    /// From the beginning: replays the whole file (samples, small logs).
    Beginning,
}

/// Follows a log file. Opens it shared for reading, writing and deleting, so the game keeps
/// writing and the file can be removed while it is followed.
///
/// - A file that does not exist yet is waited for; once it appears it is read from its beginning.
/// - A file truncated or replaced (deleted and created again) is read again from its beginning.
/// - A line is returned only once its line break is written; `\r\n` and `\n` both end a line.
///   Bytes that are not UTF-8 are replaced (`U+FFFD`); empty lines are skipped.
#[derive(Debug)]
pub struct Tail {
    path: PathBuf,
    file: Option<OpenFile>,
    /// What the next opening of the file starts from.
    start: Start,
    /// Bytes after the last line break, waiting for the rest of their line.
    pending: Vec<u8>,
    /// Started in the middle of a line: drop everything up to the next line break.
    skip_partial: bool,
}

#[derive(Debug)]
struct OpenFile {
    file: File,
    /// Creation time of the opened file: another one at the same path means it was replaced.
    created: Option<SystemTime>,
    position: u64,
}

impl Tail {
    /// Opens `path` right away (so lines written before the first [`poll`](Tail::poll) are not
    /// missed); a missing or unreadable file is retried by every `poll`.
    pub fn new(path: impl Into<PathBuf>, start: Start) -> Self {
        let mut tail = Tail { path: path.into(), file: None, start, pending: Vec::new(), skip_partial: false };
        // Not there yet: whatever the game writes into it later is new.
        if tail.open().is_err() {
            tail.start = Start::Beginning;
        }
        tail
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The file is open (exists and is readable).
    pub fn is_open(&self) -> bool {
        self.file.is_some()
    }

    /// Byte offset of the next read in the open file.
    pub fn position(&self) -> Option<u64> {
        self.file.as_ref().map(|f| f.position)
    }

    /// Complete lines appended since the previous call, in order. A missing file is not an error:
    /// it yields nothing until it appears. Errors are reading errors of an existing file.
    pub fn poll(&mut self) -> io::Result<Vec<String>> {
        self.follow_path()?;
        let Some(open) = self.file.as_mut() else { return Ok(Vec::new()) };

        let len = open.file.metadata()?.len();
        if len < open.position {
            // Truncated in place: everything in it now is new.
            open.position = 0;
            self.pending.clear();
            self.skip_partial = false;
        }
        if len == open.position {
            return Ok(Vec::new());
        }

        open.file.seek(SeekFrom::Start(open.position))?;
        let mut chunk = Vec::new();
        let read = (&mut open.file).take((len - open.position).min(MAX_READ)).read_to_end(&mut chunk)?;
        open.position += read as u64;
        Ok(self.split_lines(&chunk))
    }

    /// Notices a file that appeared, disappeared or was replaced at the path.
    fn follow_path(&mut self) -> io::Result<()> {
        let meta = match fs::metadata(&self.path) {
            Ok(meta) => meta,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                // Let go of a deleted file; its successor is read from the beginning.
                self.file = None;
                return Ok(());
            }
            Err(e) => return Err(e),
        };
        let replaced = match &self.file {
            None => true,
            Some(open) => meta.created().ok() != open.created || meta.len() < open.position,
        };
        if replaced {
            self.open()?;
        }
        Ok(())
    }

    fn open(&mut self) -> io::Result<()> {
        let mut file = open_shared(&self.path)?;
        let meta = file.metadata()?;
        let position = match self.start {
            Start::Beginning => 0,
            Start::End => meta.len(),
        };
        // Opened in the middle of a line being written: its head is gone, skip the tail.
        self.skip_partial = position > 0 && !ends_with_line_break(&mut file, position)?;
        self.pending.clear();
        self.file = Some(OpenFile { file, created: meta.created().ok(), position });
        // A later reopening means the file was replaced: read the new one whole.
        self.start = Start::Beginning;
        Ok(())
    }

    fn split_lines(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        let mut consumed = 0;
        while let Some(end) = self.pending[consumed..].iter().position(|&b| b == b'\n') {
            let raw = &self.pending[consumed..consumed + end];
            let raw = raw.strip_suffix(b"\r").unwrap_or(raw);
            if self.skip_partial {
                self.skip_partial = false;
            } else if !raw.is_empty() {
                lines.push(String::from_utf8_lossy(raw).into_owned());
            }
            consumed += end + 1;
        }
        self.pending.drain(..consumed);
        if self.pending.len() > MAX_LINE {
            self.pending.clear();
            self.skip_partial = true;
        }
        lines
    }
}

fn ends_with_line_break(file: &mut File, len: u64) -> io::Result<bool> {
    let mut last = [0u8; 1];
    file.seek(SeekFrom::Start(len - 1))?;
    file.read_exact(&mut last)?;
    Ok(last[0] == b'\n')
}

/// Opens for reading without denying the game anything: it keeps writing, the user can delete.
fn open_shared(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 0x1;
        const FILE_SHARE_WRITE: u32 = 0x2;
        const FILE_SHARE_DELETE: u32 = 0x4;
        options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
    }
    options.open(path)
}
