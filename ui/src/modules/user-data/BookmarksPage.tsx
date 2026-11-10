import { useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Bookmark as BookmarkIcon,
  Bug,
  Check,
  Coins,
  Crown,
  ExternalLink,
  Flame,
  FlaskConical,
  Folder as FolderIcon,
  FolderPlus,
  Gem,
  Hammer,
  Heart,
  Map as MapIcon,
  Package,
  Pencil,
  Plus,
  ScrollText,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Swords,
  Target,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, CardHeader, CardSection, cx, Dialog, EmptyState, Field, IconButton, Input, Page, Select, StatusBadge, Switch, toast } from "@/design-system";
import { useCurrentLeague } from "@/app/leagues";
import { useAccount } from "@/app/account";
import {
  bySortKey,
  keyBetween,
  keyForMove,
  nowIso,
  openTrade,
  parseTradeUrl,
  removeRecord,
  saveRecord,
  tradeUrl,
  useRecords,
  type Bookmark,
  type Folder,
} from "@/app/user-data";

/** Иконки папок — те же имена, что в расширении (shared/types.ts, FOLDER_ICONS). */
const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: FolderIcon,
  swords: Swords,
  shield: Shield,
  gem: Gem,
  coins: Coins,
  sparkles: Sparkles,
  map: MapIcon,
  crown: Crown,
  skull: Skull,
  flame: Flame,
  snowflake: Snowflake,
  zap: Zap,
  target: Target,
  star: Star,
  heart: Heart,
  hammer: Hammer,
  flask: FlaskConical,
  scroll: ScrollText,
  bug: Bug,
  package: Package,
};

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

export function openWithToast(url: string) {
  openTrade(url).then(
    (where) => where === "browser" && toast({ status: "info", title: "Открыто в браузере", description: "Расширение не на связи — поиск открыт в новой вкладке." }),
    fail("Поиск не открыт"),
  );
}

type FolderForm = { id?: string; title: string; icon: string };

function FolderDialog({ form, onClose, folders }: { form: FolderForm | null; onClose: () => void; folders: Folder[] }) {
  const [title, setTitle] = useState(form?.title ?? "");
  const [icon, setIcon] = useState(form?.icon ?? "folder");
  if (!form) return null;
  const save = async () => {
    const existing = folders.find((f) => f.id === form.id);
    if (existing) await saveRecord("folders", { ...existing, title: title.trim(), icon });
    else {
      const last = [...folders].sort(bySortKey).at(-1)?.sortKey ?? null;
      await saveRecord("folders", { title: title.trim(), icon, archivedAt: null, sortKey: await keyBetween(last, null) });
    }
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={form.id ? "Папка" : "Новая папка"}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => save().catch(fail("Папка не сохранена"))}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Название">{({ id }) => <Input id={id} value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div role="radiogroup" aria-label="Значок" className="flex flex-wrap gap-1.5">
          {Object.entries(FOLDER_ICONS).map(([name, Icon]) => (
            <IconButton key={name} icon={Icon} label={name} tooltip={false} active={icon === name} aria-checked={icon === name} role="radio" onClick={() => setIcon(name)} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

type BookmarkForm = { bookmark?: Bookmark; folderId: string };

function BookmarkDialog({ form, onClose, folders, bookmarks }: { form: BookmarkForm | null; onClose: () => void; folders: Folder[]; bookmarks: Bookmark[] }) {
  const [title, setTitle] = useState(form?.bookmark?.title ?? "");
  const [url, setUrl] = useState("");
  const [folderId, setFolderId] = useState(form?.folderId ?? "");
  if (!form) return null;
  const parsed = form.bookmark ? null : parseTradeUrl(url);
  const save = async () => {
    const inFolder = bookmarks.filter((b) => b.folderId === folderId).sort(bySortKey);
    const atEnd = async () => keyBetween(inFolder.at(-1)?.sortKey ?? null, null);
    if (form.bookmark) {
      const moved = form.bookmark.folderId !== folderId;
      await saveRecord("bookmarks", { ...form.bookmark, title: title.trim(), folderId, sortKey: moved ? await atEnd() : form.bookmark.sortKey });
    } else if (parsed) {
      await saveRecord("bookmarks", { folderId, title: title.trim() || parsed.slug, tradeType: parsed.tradeType, slug: parsed.slug, completedAt: null, sortKey: await atEnd() });
    }
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={form.bookmark ? "Закладка" : "Новая закладка"}
      description={form.bookmark ? undefined : "Скопируйте адрес поиска с сайта торговли PoE 1. Лига при открытии подставляется текущая."}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!(form.bookmark ? title.trim() : parsed)} onClick={() => save().catch(fail("Закладка не сохранена"))}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!form.bookmark && (
          <Field label="Адрес поиска" hint={url && !parsed ? "Нужен адрес вида pathofexile.com/trade/search/<лига>/<поиск>" : undefined}>
            {({ id }) => <Input id={id} value={url} autoFocus placeholder="https://www.pathofexile.com/trade/search/…" onChange={(e) => setUrl(e.target.value)} />}
          </Field>
        )}
        <Field label="Название">{({ id }) => <Input id={id} value={title} maxLength={200} placeholder={parsed?.slug} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Папка">
          {({ id }) => <Select id={id} value={folderId} onValueChange={setFolderId} options={folders.map((f) => ({ value: f.id, label: f.title }))} />}
        </Field>
      </div>
    </Dialog>
  );
}

function Confirm({ text, onConfirm, onClose }: { text: ReactNode | null; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  if (!text) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Удалить?"
      description={text}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon={Trash2} onClick={() => onConfirm().then(onClose, fail("Не удалено"))}>
            Удалить
          </Button>
        </>
      }
    />
  );
}

/** Закладки поисков (Ф10): те же папки, что в панели расширения; правки уходят в расширение и на сервер. */
export function BookmarksPage() {
  const folders = useRecords<Folder>("folders");
  const bookmarks = useRecords<Bookmark>("bookmarks");
  const league = useCurrentLeague();
  const signedIn = useAccount((a) => a.status?.state === "signedIn");
  const [showArchived, setShowArchived] = useState(false);
  const [folderForm, setFolderForm] = useState<FolderForm | null>(null);
  const [bookmarkForm, setBookmarkForm] = useState<BookmarkForm | null>(null);
  const [confirm, setConfirm] = useState<{ text: ReactNode; run: () => Promise<unknown> } | null>(null);

  const all = [...(folders ?? [])].sort(bySortKey);
  const visible = all.filter((f) => showArchived || !f.archivedAt);
  const marks = bookmarks ?? [];

  const moveFolder = async (folder: Folder, delta: number) => {
    const index = all.indexOf(folder);
    const to = index + delta;
    if (to < 0 || to >= all.length) return;
    await saveRecord("folders", { ...folder, sortKey: await keyForMove(all, index, to) });
  };
  const moveBookmark = async (list: Bookmark[], bookmark: Bookmark, delta: number) => {
    const index = list.indexOf(bookmark);
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    await saveRecord("bookmarks", { ...bookmark, sortKey: await keyForMove(list, index, to) });
  };

  return (
    <Page
      title="Закладки"
      subtitle={`Поиски сайта торговли PoE 1 · ${signedIn ? "синхронизируются с аккаунтом и расширением" : "общие с расширением на этом компьютере"}`}
      actions={
        <div className="flex items-center gap-3">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} label="Архив" />
          <Button variant="primary" icon={FolderPlus} onClick={() => setFolderForm({ title: "", icon: "folder" })}>
            Папка
          </Button>
        </div>
      }
    >
      {folders === null ? null : visible.length === 0 ? (
        <EmptyState icon={BookmarkIcon} title="Закладок нет">
          Сохраняйте поиски в панели расширения на сайте торговли — они появятся здесь. Или создайте папку и добавьте адрес поиска.
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-col gap-4">
          {visible.map((folder) => {
            const Icon = FOLDER_ICONS[folder.icon] ?? FolderIcon;
            const list = marks.filter((b) => b.folderId === folder.id).sort(bySortKey);
            return (
              <Card key={folder.id} className={cx(folder.archivedAt && "opacity-70")}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden className="size-4 text-text-secondary" />
                      {folder.title}
                      <span className="text-label font-normal text-text-secondary">{list.length}</span>
                      {folder.archivedAt && <StatusBadge status="info">архив</StatusBadge>}
                    </span>
                  }
                  aside={
                    <span className="flex items-center gap-0.5">
                      <IconButton icon={Plus} label="Добавить поиск" onClick={() => setBookmarkForm({ folderId: folder.id })} />
                      <IconButton icon={ArrowUp} label="Выше" onClick={() => moveFolder(folder, -1).catch(fail("Не перемещено"))} />
                      <IconButton icon={ArrowDown} label="Ниже" onClick={() => moveFolder(folder, 1).catch(fail("Не перемещено"))} />
                      <IconButton icon={Pencil} label="Переименовать" onClick={() => setFolderForm({ id: folder.id, title: folder.title, icon: folder.icon })} />
                      <IconButton
                        icon={folder.archivedAt ? ArchiveRestore : Archive}
                        label={folder.archivedAt ? "Вернуть из архива" : "В архив"}
                        onClick={() => saveRecord("folders", { ...folder, archivedAt: folder.archivedAt ? null : nowIso() }).catch(fail("Не изменено"))}
                      />
                      <IconButton
                        icon={Trash2}
                        label="Удалить папку"
                        onClick={() =>
                          setConfirm({
                            text: `Папка «${folder.title}» и ${list.length} поисков в ней удалятся здесь, в расширении и в аккаунте.`,
                            run: async () => {
                              for (const b of list) await removeRecord("bookmarks", b.id);
                              await removeRecord("folders", folder.id);
                            },
                          })
                        }
                      />
                    </span>
                  }
                />
                {list.length > 0 && (
                  <CardSection>
                    <ul className="flex flex-col">
                      {list.map((b) => (
                        <li key={b.id} className="flex items-center gap-2 border-b border-border-subtle py-1.5 last:border-b-0">
                          <button
                            type="button"
                            className={cx("min-w-0 flex-1 truncate text-left text-body hover:text-text-accent", b.completedAt && "text-text-secondary line-through")}
                            onClick={() => league && openWithToast(tradeUrl(b.tradeType, league.id, b.slug))}
                            title="Открыть на сайте торговли"
                          >
                            {b.title}
                          </button>
                          <span className="shrink-0 text-caption text-text-secondary">{b.tradeType === "EXCHANGE" ? "обмен" : "поиск"}</span>
                          <IconButton icon={ExternalLink} label="Открыть на сайте торговли" disabled={!league} onClick={() => league && openWithToast(tradeUrl(b.tradeType, league.id, b.slug))} />
                          <IconButton
                            icon={Check}
                            label={b.completedAt ? "Снять отметку «куплено»" : "Отметить «куплено»"}
                            active={!!b.completedAt}
                            onClick={() => saveRecord("bookmarks", { ...b, completedAt: b.completedAt ? null : nowIso() }).catch(fail("Не изменено"))}
                          />
                          <IconButton icon={ArrowUp} label="Выше" onClick={() => moveBookmark(list, b, -1).catch(fail("Не перемещено"))} />
                          <IconButton icon={ArrowDown} label="Ниже" onClick={() => moveBookmark(list, b, 1).catch(fail("Не перемещено"))} />
                          <IconButton icon={Pencil} label="Изменить или перенести" onClick={() => setBookmarkForm({ bookmark: b, folderId: b.folderId })} />
                          <IconButton icon={Trash2} label="Удалить" onClick={() => removeRecord("bookmarks", b.id).catch(fail("Не удалено"))} />
                        </li>
                      ))}
                    </ul>
                  </CardSection>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {folderForm && <FolderDialog key={folderForm.id ?? "new"} form={folderForm} folders={all} onClose={() => setFolderForm(null)} />}
      {bookmarkForm && <BookmarkDialog key={bookmarkForm.bookmark?.id ?? "new"} form={bookmarkForm} folders={all} bookmarks={marks} onClose={() => setBookmarkForm(null)} />}
      <Confirm text={confirm?.text ?? null} onConfirm={() => confirm?.run() ?? Promise.resolve()} onClose={() => setConfirm(null)} />
    </Page>
  );
}
