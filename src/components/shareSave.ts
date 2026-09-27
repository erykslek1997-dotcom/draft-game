import { useEffect, useState, type RefObject } from 'react';

/**
 * Saving a share card as a PNG, shared by every result screen's share modal (2026-09-27 results
 * audit pack C; moved here from the All-Time Draft's ShareModal). The card is captured straight
 * from its DOM with html-to-image, so the saved image always matches what is on screen. Phones get
 * the system share sheet when available; otherwise a download, and the image is also shown in
 * place so an in-app browser that blocks both (Messenger) can still long-press it to save.
 */
export function useSaveCardImage(cardRef: RefObject<HTMLElement | null>, filename: string, shareTitle: string) {
  const [saveState, setSaveState] = useState<'idle' | 'building' | 'error'>('idle');
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (savedImageUrl) URL.revokeObjectURL(savedImageUrl);
  }, [savedImageUrl]);

  const saveImage = async () => {
    const card = cardRef.current;
    if (!card) return;
    setSaveState('building');
    try {
      const { toBlob } = await import('html-to-image');
      const background = getComputedStyle(card).backgroundColor;
      const blob = await toBlob(card, {
        pixelRatio: 2,
        backgroundColor: background && background !== 'rgba(0, 0, 0, 0)' ? background : '#0b0f17',
        filter: (node) => !(node instanceof HTMLElement && node.dataset.shareExclude !== undefined),
      });
      if (!blob) throw new Error('empty image');
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: shareTitle });
          setSaveState('idle');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setSaveState('idle');
            return;
          }
        }
      }
      const url = URL.createObjectURL(blob);
      setSavedImageUrl(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSaveState('idle');
    } catch {
      setSaveState('error');
    }
  };

  return { saveState, savedImageUrl, saveImage };
}

/** "Sacramento Kings #3" -> "sacramento-kings-3-mini-draft.png". */
export function shareFilename(name: string, mode: string): string {
  return `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'my-team'}-${mode}.png`;
}

/** Copies `url` to the clipboard; resolves false when the browser refuses. */
export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
