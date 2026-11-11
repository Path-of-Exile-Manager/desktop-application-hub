//! Печатает разобранную сборку JSON-ом — для ручной проверки и сверки с другими разборщиками.
//!
//! ```text
//! cargo run -p pob-parser --example dump -- build.xml       # XML из папки Builds PoB
//! cargo run -p pob-parser --example dump -- --code code.txt # код экспорта
//! ```

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (is_code, path) = match args.as_slice() {
        [flag, path] if flag == "--code" => (true, path),
        [path] => (false, path),
        _ => {
            eprintln!("usage: dump [--code] <file>");
            return ExitCode::from(2);
        }
    };
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("{path}: {error}");
            return ExitCode::from(2);
        }
    };
    let result = if is_code {
        pob_parser::parse_code(&text)
    } else {
        pob_parser::parse_xml(&text)
    };
    match result {
        Ok(build) => {
            println!(
                "{}",
                serde_json::to_string(&build).expect("serialize build")
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
