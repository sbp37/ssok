import { useRef, useState } from "react";
import { Environment, Share } from "@apps-in-toss/web-framework";

const SHARE_PAGE_URL = "https://sbp37.github.io/ssok/";
const SHARE_IMAGE_URL = `${SHARE_PAGE_URL}branding/share-stretch.jpg?v=20260915`;
const TAGLINE = "쭈우욱… 쏙! 말랑한 젤 비즈를 뽑아봐";

/** Toss deep link inside the app, Web Share API or a copied link elsewhere. */
async function shareGame(padName?: string): Promise<"shared" | "copied"> {
  const lead = padName ? `${padName} 패드 다 비웠다!` : "";
  let inToss = false;
  try {
    inToss = Environment.environment === "toss" || Environment.environment === "sandbox";
  } catch {
    // The normal web build has no Toss host constants.
  }

  if (inToss) {
    const link = await Share.createLink({
      path: "intoss://ssok-picky-pad/",
      ogImageUrl: SHARE_IMAGE_URL,
    });
    await Share.sendMessage({
      message: `${lead ? lead + "\n" : ""}쭈우욱… 쏙!\n말랑한 젤 비즈를 뽑아봐\n${link}`,
    });
    return "shared";
  }

  if (navigator.share) {
    await navigator.share({
      title: "쏙: 피키패드",
      text: lead ? `${lead} ${TAGLINE}` : TAGLINE,
      url: SHARE_PAGE_URL,
    });
    return "shared";
  }
  await navigator.clipboard.writeText(SHARE_PAGE_URL);
  return "copied";
}

/**
 * One share flow for every button: ignores double taps, treats a user
 * cancelling the share sheet as nothing, and reports only what they need to know.
 */
export function useShare(onNotice: (text: string) => void) {
  const sharing = useRef(false);
  const [busy, setBusy] = useState(false);
  const share = async (padName?: string) => {
    if (sharing.current) return;
    sharing.current = true;
    setBusy(true);
    try {
      const result = await shareGame(padName);
      if (result === "copied") onNotice("링크를 복사했어.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        onNotice("공유를 열지 못했어. 잠시 후 다시 눌러 줘.");
      }
    } finally {
      sharing.current = false;
      setBusy(false);
    }
  };
  return { busy, share };
}
