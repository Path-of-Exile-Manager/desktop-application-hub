import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "@/design-system";
import { saveRecord } from "@/app/user-data";
import type { PobLink } from "@/generated/PobLink";
import { openSourcePage, SITE_LABEL, sourceOf, type PobBuildRecord } from "./model";

// pobb.in и программа Path of Building (план shared/docs/pob-trader.md, L2, решение 3.12).
// Билд со ссылкой (импортирован или уже выгружен) открывается по ней; без ссылки — код выгружается
// на pobb.in, но только после подтверждения: ссылка станет доступна всем, кто её знает.

/** «Больше не спрашивать» о публикации на pobb.in — настройка этого компьютера. */
export const useSharePrefs = create<{ skipConfirm: boolean; setSkipConfirm: (v: boolean) => void }>()(
  persist((set) => ({ skipConfirm: false, setSkipConfirm: (skipConfirm) => set({ skipConfirm }) }), { name: "poe-manager.pob-builds-share" }),
);

const shareCode = (code: string) => invoke<PobLink>("pob_share", { code });
const openInPob = (url: string) => invoke<void>("pob_open_in_pob", { url });

/** Что сделать со ссылкой, когда она есть. */
export type ShareAction = "page" | "pob";

/** Спросить подтверждение публикации (диалог страницы); `false` — пользователь отказался. */
export type ConfirmPublish = (build: PobBuildRecord) => Promise<boolean>;

/** Ссылка билда: своя или новая с pobb.in (после подтверждения); новая сохраняется в запись. */
async function linkOf(build: PobBuildRecord, confirm: ConfirmPublish): Promise<string | null> {
  if (build.source) return build.source.url;
  if (!useSharePrefs.getState().skipConfirm && !(await confirm(build))) return null;
  const link = await shareCode(build.code);
  await saveRecord("pobBuilds", { ...build, source: sourceOf(link) });
  toast({ status: "success", title: "Билд выгружен на pobb.in", description: link.url });
  return link.url;
}

export async function runShare(build: PobBuildRecord, action: ShareAction, confirm: ConfirmPublish): Promise<void> {
  try {
    const url = await linkOf(build, confirm);
    if (!url) return;
    if (action === "page") await openSourcePage(url);
    else {
      await openInPob(url);
      toast({ status: "info", title: "Открываем в Path of Building", description: "Если программа не открылась — «Скопировать код» и Import from clipboard в PoB." });
    }
  } catch (e) {
    toast({ status: "warning", title: action === "page" ? "Страница не открыта" : "Не открыто в PoB", description: String(e) });
  }
}

/** Подпись кнопки «на сайте»: сайт ссылки или pobb.in (туда выгрузится). */
export const pageLabel = (build: PobBuildRecord) => `Открыть на ${build.source ? SITE_LABEL[build.source.site] : "pobb.in"}`;
