// components/ReviewPrompt.tsx
//
// "Enjoying Sweep?" — asked once, in our own words.
//
// Rendered at the root rather than in each screen, because the ask is
// triggered from five places and the dialog should exist once.
//
// Why a dialog of our own rather than Play's native review sheet: Google
// forbids asking anything before that sheet, so there's no room to explain who
// made this or why it matters. Its quota also means it sometimes shows nothing
// at all. A dialog that links to the listing has neither problem — and the
// explanation is the point, because "one person made this" is a far better
// reason to leave a rating than "rate us" is.
//
// Saying no is final. The gate never asks twice, whichever way it's answered,
// so the cancel button says "No thanks" rather than "Not now" — the softer
// wording would imply a second ask that is never coming.

import { Linking } from "react-native";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useTranslate } from "@/lib/i18n";
import { closeReviewAsk, useReviewAskOpen } from "@/lib/reviewAsk";
import { storeListingUrl } from "@/lib/reviewPrompt";

export default function ReviewPrompt() {
  const open = useReviewAskOpen();
  const t = useTranslate();

  return (
    <ConfirmDialog
      content={
        open
          ? {
              icon: "heart-outline",
              title: t("review.title"),
              body: t("review.body"),
              confirmLabel: t("review.rate"),
              cancelLabel: t("review.no"),
            }
          : null
      }
      onCancel={closeReviewAsk}
      onConfirm={() => {
        closeReviewAsk();
        const url = storeListingUrl();
        // Null on a device with no store app. Closing quietly is the right
        // failure: they said yes to a favour, and an error message about it
        // would turn a kindness into a problem.
        if (url) void Linking.openURL(url).catch(() => {});
      }}
    />
  );
}
