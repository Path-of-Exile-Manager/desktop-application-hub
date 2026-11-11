import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AppWindow, ChevronLeft, ChevronRight, Copy, Ellipsis, ExternalLink, FolderInput, FolderMinus, Import, Inbox, Layers, Library, Pencil, Plus, Swords, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, cx, EmptyState, IconButton, Menu, Page, Pagination, SearchInput, usePageSize, type MenuEntry } from "@/design-system";
import { useAccount } from "@/app/account";
import { bySortKey, keyBetween, removeRecord, saveRecord, useRecords } from "@/app/user-data";
import { AddBuildDialog, BuildSummaryDialog, ConfirmDialog, copyCode, fail, ImportDialog, NameDialog, PublishDialog, type AddForm } from "./dialogs";
import {
  buildSubtitle,
  byCreatedDesc,
  formatDate,
  GROUP_NAME_MAX,
  inGroup,
  matchesQuery,
  NAME_MAX,
  newBuildRecord,
  type GroupFilter,
  type PobBuildGroup,
  type PobBuildRecord,
} from "./model";
import { BuildView } from "./BuildView";
import { Portrait } from "./parts";
import { usePortraitsSync } from "./portraits";
import { pageLabel, runShare, type ShareAction } from "./share";

// Вкладка «Билды» (план shared/docs/pob-trader.md, P6): библиотека сборок Path of Building — группы
// слева, список справа; у строки — «Открыть на сайте» и «Открыть в Path of Building» (без ссылки —
// выгрузка на pobb.in с подтверждением, share.ts). «Открыть» — экран сборки с ценами (BuildView.tsx).

const ROW_HEIGHT = 56;
const GROUP_ROW_HEIGHT = 36;
const RAIL_WIDTH = 232;
/** Тип данных при перетаскивании билда в группу. */
const DRAG_TYPE = "application/x-poe-manager-build";

type Dialogs =
  | { kind: "add"; form: AddForm }
  | { kind: "summary"; title: string; code: string; unsaved?: AddForm }
  | { kind: "rename-build"; build: PobBuildRecord }
  | { kind: "new-group" }
  | { kind: "rename-group"; group: PobBuildGroup }
  | { kind: "delete-group"; group: PobBuildGroup; count: number }
  | { kind: "delete-build"; build: PobBuildRecord }
  | { kind: "import" };

const NO_BUILDS: PobBuildRecord[] = [];
const NO_GROUPS: PobBuildGroup[] = [];

export function PobBuildsPage() {
  usePortraitsSync();
  const builds = useRecords<PobBuildRecord>("pobBuilds");
  const groupRecords = useRecords<PobBuildGroup>("pobBuildGroups");
  const signedIn = useAccount((a) => a.status?.state === "signedIn");
  const [filter, setFilter] = useState<GroupFilter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [publish, setPublish] = useState<{ build: PobBuildRecord; answer: (ok: boolean) => void } | null>(null);
  const share = (build: PobBuildRecord, action: ShareAction) =>
    void runShare(build, action, (b) => new Promise<boolean>((answer) => setPublish({ build: b, answer })));
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? (builds ?? NO_BUILDS).find((b) => b.id === openId) : undefined;
  const publishDialog = publish && (
    <PublishDialog
      name={publish.build.name}
      onAnswer={(ok) => {
        publish.answer(ok);
        setPublish(null);
      }}
    />
  );

  const all = builds ?? NO_BUILDS;
  const groups = useMemo(() => [...(groupRecords ?? NO_GROUPS)].sort(bySortKey), [groupRecords]);
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const activeGroup = filter.kind === "group" ? groups.find((g) => g.id === filter.id) : undefined;
  // Выбранную группу удалили (здесь или на другом устройстве) — назад ко всем. Только что созданной
  // группы в списке ещё нет (список перечитывается по событию), поэтому сброс — лишь когда она в
  // списке уже была и пропала.
  const seenGroup = useRef<string | null>(null);
  useEffect(() => {
    if (filter.kind !== "group") return;
    if (activeGroup) seenGroup.current = filter.id;
    else if (seenGroup.current === filter.id) setFilter({ kind: "all" });
  }, [filter, activeGroup]);

  const shown = useMemo(
    () => all.filter((b) => inGroup(b, filter, groupIds) && matchesQuery(b, query)).sort(byCreatedDesc),
    [all, filter, groupIds, query],
  );
  const countOf = (f: GroupFilter) => all.filter((b) => inGroup(b, f, groupIds)).length;
  const groupName = (b: PobBuildRecord) => (b.groupId && groups.find((g) => g.id === b.groupId)?.name) || null;

  const moveTo = (build: PobBuildRecord, groupId: string | null) =>
    build.groupId === groupId ? Promise.resolve() : saveRecord("pobBuilds", { ...build, groupId }).then(() => undefined, fail("Не перенесено"));

  const addBuild = async (input: Omit<Parameters<typeof newBuildRecord>[0], "sortKey">) => {
    const last = [...all].sort(bySortKey).at(-1)?.sortKey ?? null;
    await saveRecord("pobBuilds", newBuildRecord({ ...input, sortKey: await keyBetween(last, null) }));
  };

  // Открытый билд удалили (здесь или на другом устройстве) — назад к списку.
  useEffect(() => {
    if (openId && builds && !opened) setOpenId(null);
  }, [openId, builds, opened]);
  if (opened)
    return (
      <>
        <BuildView key={opened.id} record={opened} onBack={() => setOpenId(null)} onShare={share} />
        {publishDialog}
      </>
    );

  const title = filter.kind === "all" ? "Все билды" : filter.kind === "none" ? "Без группы" : (activeGroup?.name ?? "Группа");
  const defaultGroup = filter.kind === "group" ? filter.id : null;

  return (
    <Page
      title="Билды"
      subtitle={`Сборки Path of Building · ${signedIn ? "синхронизируются с аккаунтом" : "хранятся на этом компьютере, с аккаунтом — на всех устройствах"}`}
      actions={
        <>
          <Button icon={Import} onClick={() => setDialog({ kind: "import" })}>
            Импорт
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "add", form: { groupId: defaultGroup } })}>
            Добавить билд
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 gap-4">
        <GroupRail
          groups={groups}
          filter={filter}
          countOf={countOf}
          onSelect={setFilter}
          onNew={() => setDialog({ kind: "new-group" })}
          onRename={(group) => setDialog({ kind: "rename-group", group })}
          onDelete={(group) => setDialog({ kind: "delete-group", group, count: countOf({ kind: "group", id: group.id }) })}
          onDrop={(buildId, groupId) => {
            const build = all.find((b) => b.id === buildId);
            if (build) void moveTo(build, groupId);
          }}
        />
        <Card className="min-h-0 flex-1">
          <CardHeader
            title={
              <span>
                {title} <span className="font-normal text-text-muted">{shown.length}</span>
              </span>
            }
            aside={<SearchInput value={query} onValueChange={setQuery} label="Поиск билдов" placeholder="Название или класс" className="w-64" />}
          />
          {builds === null ? null : all.length === 0 ? (
            <EmptyState
              icon={Library}
              title="Здесь пока нет билдов"
              action={
                <Button icon={Plus} onClick={() => setDialog({ kind: "add", form: { groupId: defaultGroup } })}>
                  Добавить билд
                </Button>
              }
              className="flex-1"
            >
              Вставьте код экспорта из Path of Building — билд сохранится в библиотеке и, со входом в аккаунт, появится на других устройствах.
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState icon={query ? Swords : Inbox} title={query ? "Ничего не найдено" : "В этой группе пусто"} className="flex-1">
              {query ? "Попробуйте другое название или класс." : "Перетащите билд сюда из списка или выберите группу в его меню."}
            </EmptyState>
          ) : (
            <BuildList
              builds={shown}
              groups={groups}
              groupName={groupName}
              onOpen={(b) => setOpenId(b.id)}
              onRename={(build) => setDialog({ kind: "rename-build", build })}
              onDelete={(build) => setDialog({ kind: "delete-build", build })}
              onMove={(b, groupId) => void moveTo(b, groupId)}
              onShare={share}
            />
          )}
        </Card>
      </div>

      {publishDialog}
      {dialog?.kind === "import" && <ImportDialog builds={all} groups={groups} onClose={() => setDialog(null)} />}
      {dialog?.kind === "add" && (
        <AddBuildDialog
          form={dialog.form}
          groups={groups}
          onClose={() => setDialog(null)}
          onSave={addBuild}
          onPreview={(input) => setDialog({ kind: "summary", title: input.name, code: input.code, unsaved: { code: input.link?.url ?? input.code, name: input.name, groupId: input.groupId } })}
        />
      )}
      {dialog?.kind === "summary" && (
        <BuildSummaryDialog
          title={dialog.title}
          code={dialog.code}
          onClose={() => setDialog(null)}
          onSave={dialog.unsaved ? () => dialog.unsaved && setDialog({ kind: "add", form: dialog.unsaved }) : undefined}
        />
      )}
      {dialog?.kind === "rename-build" && (
        <NameDialog
          title="Переименовать билд"
          label="Название"
          initial={dialog.build.name}
          max={NAME_MAX}
          onClose={() => setDialog(null)}
          onSave={(name) => saveRecord("pobBuilds", { ...dialog.build, name })}
        />
      )}
      {dialog?.kind === "new-group" && (
        <NameDialog
          title="Новая группа"
          label="Название группы"
          initial=""
          max={GROUP_NAME_MAX}
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const saved = (await saveRecord("pobBuildGroups", { name, sortKey: await keyBetween(groups.at(-1)?.sortKey ?? null, null) })) as PobBuildGroup;
            setFilter({ kind: "group", id: saved.id });
          }}
        />
      )}
      {dialog?.kind === "rename-group" && (
        <NameDialog
          title="Переименовать группу"
          label="Название группы"
          initial={dialog.group.name}
          max={GROUP_NAME_MAX}
          onClose={() => setDialog(null)}
          onSave={(name) => saveRecord("pobBuildGroups", { ...dialog.group, name })}
        />
      )}
      {dialog?.kind === "delete-group" && (
        <ConfirmDialog
          title="Удалить группу?"
          text={`Группа «${dialog.group.name}» удалится${dialog.count ? `, ${dialog.count} билдов в ней останутся в библиотеке без группы` : ""}.`}
          action="Удалить группу"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            for (const b of all.filter((b) => b.groupId === dialog.group.id)) await saveRecord("pobBuilds", { ...b, groupId: null });
            await removeRecord("pobBuildGroups", dialog.group.id);
          }}
        />
      )}
      {dialog?.kind === "delete-build" && (
        <ConfirmDialog
          title="Удалить билд?"
          text={`«${dialog.build.name}» удалится из библиотеки${signedIn ? " и с других устройств" : ""}.`}
          action="Удалить"
          onClose={() => setDialog(null)}
          onConfirm={() => removeRecord("pobBuilds", dialog.build.id)}
        />
      )}
    </Page>
  );
}

function GroupRail({
  groups,
  filter,
  countOf,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onDrop,
}: {
  groups: PobBuildGroup[];
  filter: GroupFilter;
  countOf: (f: GroupFilter) => number;
  onSelect: (f: GroupFilter) => void;
  onNew: () => void;
  onRename: (g: PobBuildGroup) => void;
  onDelete: (g: PobBuildGroup) => void;
  onDrop: (buildId: string, groupId: string | null) => void;
}) {
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: GROUP_ROW_HEIGHT });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const visible = groups.slice((page - 1) * pageSize, page * pageSize);
  const same = (f: GroupFilter) => f.kind === filter.kind && (f.kind !== "group" || (filter.kind === "group" && filter.id === f.id));

  return (
    <nav aria-label="Группы билдов" style={{ width: RAIL_WIDTH }} className="flex min-h-0 shrink-0 flex-col rounded-lg border border-border-default bg-bg-surface">
      <div className="flex shrink-0 flex-col gap-0.5 border-b border-border-subtle p-1.5">
        <GroupRow icon={Layers} label="Все билды" count={countOf({ kind: "all" })} active={same({ kind: "all" })} onClick={() => onSelect({ kind: "all" })} />
        <GroupRow
          icon={FolderMinus}
          label="Без группы"
          count={countOf({ kind: "none" })}
          active={same({ kind: "none" })}
          onClick={() => onSelect({ kind: "none" })}
          onDropBuild={(id) => onDrop(id, null)}
        />
      </div>
      <header className="flex h-9 shrink-0 items-center justify-between pr-1.5 pl-3">
        <span className="text-caption font-semibold tracking-caps text-text-muted uppercase">Группы</span>
        <IconButton icon={Plus} label="Новая группа" onClick={onNew} className="size-7" iconSize={16} />
      </header>
      <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-1.5">
        {groups.length === 0 ? (
          <p className="px-2 py-1 text-caption text-text-muted">Групп нет — «+» создаст первую.</p>
        ) : (
          visible.map((g) => {
            const f: GroupFilter = { kind: "group", id: g.id };
            return (
              <GroupRow
                key={g.id}
                icon={FolderInput}
                label={g.name}
                count={countOf(f)}
                active={same(f)}
                onClick={() => onSelect(f)}
                onDropBuild={(id) => onDrop(id, g.id)}
                menu={[
                  { label: "Переименовать", icon: Pencil, onSelect: () => onRename(g) },
                  { label: "Удалить группу", icon: Trash2, onSelect: () => onDelete(g) },
                ]}
              />
            );
          })
        )}
      </div>
      {pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border-subtle py-1 font-mono text-caption text-text-muted">
          <IconButton icon={ChevronLeft} label="Предыдущие группы" disabled={page <= 1} onClick={() => setPage(page - 1)} className="size-7" iconSize={14} />
          {page}/{pageCount}
          <IconButton icon={ChevronRight} label="Следующие группы" disabled={page >= pageCount} onClick={() => setPage(page + 1)} className="size-7" iconSize={14} />
        </div>
      )}
    </nav>
  );
}

function GroupRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  onDropBuild,
  menu,
}: {
  icon: typeof Layers;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDropBuild?: (buildId: string) => void;
  menu?: MenuEntry[];
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => onDropBuild && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <div
      className="group relative"
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (id && onDropBuild) {
          e.preventDefault();
          onDropBuild(id);
        }
      }}
    >
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        style={{ height: GROUP_ROW_HEIGHT - 2 }}
        className={cx(
          "flex w-full min-w-0 items-center gap-2 rounded-md border-l-2 pl-2.5 text-left text-body transition-colors",
          menu ? "pr-9" : "pr-2.5",
          active ? "border-accent-solid bg-accent-subtle font-semibold text-text-primary" : "border-transparent text-text-primary hover:bg-bg-hover",
          over && "bg-bg-active ring-1 ring-border-focus",
        )}
      >
        <Icon aria-hidden size={15} className="shrink-0 text-icon-default" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cx("font-mono text-caption text-text-muted", menu && "group-hover:invisible group-focus-within:invisible")}>{count}</span>
      </button>
      {menu && (
        <span className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Menu align="end" items={menu} trigger={<IconButton icon={Ellipsis} label={`Действия: ${label}`} tooltip={false} className="size-7" iconSize={14} />} />
        </span>
      )}
    </div>
  );
}

function BuildList({
  builds,
  groups,
  groupName,
  onOpen,
  onRename,
  onDelete,
  onMove,
  onShare,
}: {
  builds: PobBuildRecord[];
  groups: PobBuildGroup[];
  groupName: (b: PobBuildRecord) => string | null;
  onOpen: (b: PobBuildRecord) => void;
  onRename: (b: PobBuildRecord) => void;
  onDelete: (b: PobBuildRecord) => void;
  onMove: (b: PobBuildRecord, groupId: string | null) => void;
  onShare: (b: PobBuildRecord, action: ShareAction) => void;
}) {
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(builds.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const visible = builds.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        <ul className="flex flex-col">
          {visible.map((b) => {
            const group = groupName(b);
            const menu: MenuEntry[] = [
              { label: "Переименовать", icon: Pencil, onSelect: () => onRename(b) },
              { type: "separator" },
              { type: "label", label: "В группу" },
              { label: "Без группы", icon: FolderMinus, disabled: !group, onSelect: () => onMove(b, null) },
              ...groups.map((g) => ({ label: g.name, icon: FolderInput, disabled: g.id === b.groupId, onSelect: () => onMove(b, g.id) })),
              { type: "separator" },
              { label: "Удалить", icon: Trash2, onSelect: () => onDelete(b) },
            ];
            return (
              <li
                key={b.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, b.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                style={{ height: ROW_HEIGHT }}
                className="flex items-center gap-3 border-b border-border-subtle px-card-padding-x last:border-b-0 hover:bg-bg-hover"
              >
                <Portrait build={b} />
                <button type="button" onClick={() => onOpen(b)} className="flex min-w-0 flex-1 flex-col text-left" title="Открыть">
                  <span className="truncate text-body font-medium text-text-primary">{b.name}</span>
                  <span className="truncate text-label text-text-secondary">{buildSubtitle(b)}</span>
                </button>
                <span className="hidden w-40 shrink-0 truncate text-label text-text-secondary lg:block">{group ?? "Без группы"}</span>
                <span className="w-22 shrink-0 text-right font-mono text-label text-text-muted">{formatDate(b.createdAt)}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" onClick={() => onOpen(b)}>
                    Открыть
                  </Button>
                  <IconButton icon={Copy} label="Скопировать код для PoB" onClick={() => copyCode(b.code)} />
                  <IconButton icon={ExternalLink} label={b.source ? pageLabel(b) : `${pageLabel(b)} (выгрузить)`} onClick={() => onShare(b, "page")} />
                  <IconButton icon={AppWindow} label="Открыть в Path of Building" onClick={() => onShare(b, "pob")} />
                  <Menu align="end" items={menu} trigger={<IconButton icon={Ellipsis} label={`Действия: ${b.name}`} />} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {pageCount > 1 && <Pagination page={page} pageSize={pageSize} total={builds.length} onPageChange={setPage} className="border-t border-border-subtle px-card-padding-x py-2" />}
    </>
  );
}
