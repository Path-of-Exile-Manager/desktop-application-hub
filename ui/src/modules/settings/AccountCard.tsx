import { useCallback, useEffect, useState } from "react";
import { Download, LogIn, LogOut, Monitor, Puzzle, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { Button, Card, CardHeader, CardSection, Dialog, Input, StatusBadge, toast } from "@/design-system";
import {
  cancelLogin,
  deleteAccount,
  exportAccount,
  loadDevices,
  loadProfile,
  logout,
  revokeDevice,
  startLogin,
  useAccount,
  type AccountDevice,
  type AccountProfile,
} from "@/app/account";
import { inTauri } from "@/app/window";

const KIND_ICON = { DESKTOP: Monitor, EXTENSION: Puzzle, ADMIN_PANEL: ShieldCheck } as const;
const KIND_LABEL: Record<string, string> = { DESKTOP: "приложение", EXTENSION: "расширение", ADMIN_PANEL: "админка" };

const date = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function fail(title: string) {
  return (e: unknown) => toast({ status: "warning", title, description: String(e) });
}

function Avatar({ url, name }: { url: string | null | undefined; name: string }) {
  return url ? (
    <img src={url} alt="" className="size-12 shrink-0 rounded-full border border-border-default bg-bg-app object-cover" />
  ) : (
    <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-app text-title-sm text-text-secondary">
      {name.slice(0, 1).toUpperCase() || <UserRound className="size-5" />}
    </span>
  );
}

/** Раздел «Аккаунт» в Настройках (Ф7): вход через Discord, профиль, устройства, выгрузка, удаление. */
export function AccountCard() {
  const status = useAccount((a) => a.status);
  const [busy, setBusy] = useState(false);

  if (!status) return null;

  if (status.state === "signedOut") {
    return (
      <Card>
        <CardHeader title="Аккаунт" />
        <CardSection className="flex flex-col gap-3">
          <p className="text-label text-text-secondary">
            Аккаунт не обязателен. С ним закладки, история и список отслеживания синхронизируются между этим компьютером и
            расширением. Вход — через Discord в браузере.
          </p>
          {status.message && <p className="text-label text-status-warning-fg">{status.message}</p>}
          <div>
            <Button
              variant="primary"
              icon={LogIn}
              disabled={busy || !inTauri}
              onClick={() => {
                setBusy(true);
                startLogin()
                  .catch(fail("Вход не начат"))
                  .finally(() => setBusy(false));
              }}
            >
              Войти через Discord
            </Button>
          </div>
        </CardSection>
      </Card>
    );
  }

  if (status.state === "signingIn") {
    return (
      <Card>
        <CardHeader title="Аккаунт" aside={<StatusBadge status="info">ждём подтверждения</StatusBadge>} />
        <CardSection className="flex flex-col gap-3">
          <p className="text-label text-text-secondary">
            В браузере открылась страница входа. Подтвердите вход в Discord — приложение подхватит его само.
          </p>
          {status.signInUrl && (
            <p className="text-label text-text-secondary">
              Браузер не открылся? Скопируйте ссылку:
              <Input readOnly value={status.signInUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка входа" className="mt-1.5 font-mono text-caption" />
            </p>
          )}
          <div>
            <Button onClick={() => void cancelLogin()}>Отмена</Button>
          </div>
        </CardSection>
      </Card>
    );
  }

  return <SignedIn />;
}

function SignedIn() {
  const status = useAccount((a) => a.status);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [devices, setDevices] = useState<AccountDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setError(null);
    loadProfile().then(setProfile, (e) => setError(String(e)));
    loadDevices().then(setDevices, () => setDevices(null));
  }, []);
  useEffect(reload, [reload]);

  const user = status?.user;
  const name = profile?.displayName ?? user?.displayName ?? "…";

  return (
    <Card>
      <CardHeader title="Аккаунт" aside={status?.offline ? <StatusBadge status="warning">нет связи — данные из кэша</StatusBadge> : <StatusBadge status="success">вход выполнен</StatusBadge>} />
      <CardSection className="flex items-center gap-3">
        <Avatar url={profile?.avatarUrl ?? user?.avatarUrl} name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-lg font-semibold text-text-primary">{name}</p>
          <p className="text-label text-text-secondary">{profile ? `Discord · с ${date(profile.createdAt)}` : "Discord"}</p>
        </div>
        <Button
          icon={LogOut}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            logout()
              .catch(fail("Выход не выполнен"))
              .finally(() => setBusy(false));
          }}
        >
          Выйти
        </Button>
      </CardSection>
      {error && (
        <CardSection>
          <p className="text-label text-status-warning-fg">{error}</p>
        </CardSection>
      )}

      <CardSection className="flex flex-col gap-2">
        <span className="text-label text-text-secondary">Устройства, где выполнен вход</span>
        {devices === null ? (
          <p className="text-caption text-text-secondary">{status?.offline ? "нет связи с сервером" : "загрузка…"}</p>
        ) : (
          <ul className="flex flex-col">
            {devices.map((d) => {
              const Icon = KIND_ICON[d.kind as keyof typeof KIND_ICON] ?? Monitor;
              return (
                <li key={d.id} className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-b-0">
                  <Icon aria-hidden className="size-4 shrink-0 text-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-text-primary">
                      {d.name} {d.current && <StatusBadge status="info">это устройство</StatusBadge>}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {KIND_LABEL[d.kind] ?? d.kind} · был в сети {date(d.lastSeenAt)} · вход до {date(d.signedInUntil)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-7 text-label"
                    onClick={() =>
                      revokeDevice(d.id).then(() => {
                        if (!d.current) reload();
                      }, fail("Устройство не отключено"))
                    }
                  >
                    Выйти на нём
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardSection>

      <CardSection className="flex flex-wrap gap-2">
        <Button
          icon={Download}
          onClick={() => exportAccount().then((path) => toast({ status: "success", title: "Данные выгружены", description: path }), fail("Выгрузка не удалась"))}
        >
          Выгрузить мои данные
        </Button>
        <Button variant="ghost" icon={Trash2} className="text-status-danger-fg" onClick={() => setConfirmDelete(true)}>
          Удалить аккаунт
        </Button>
      </CardSection>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить аккаунт?"
        description="Аккаунт, вход через Discord и все устройства удаляются на сервере сразу и навсегда. Данные на этом компьютере останутся."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Отмена</Button>
            <Button
              variant="primary"
              icon={Trash2}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                deleteAccount()
                  .then(() => setConfirmDelete(false), fail("Аккаунт не удалён"))
                  .finally(() => setBusy(false));
              }}
            >
              Удалить навсегда
            </Button>
          </>
        }
      />
    </Card>
  );
}
