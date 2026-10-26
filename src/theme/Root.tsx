import React, {useEffect} from 'react';

// Root wraps every page on the site.
//
// WHY IT EXISTS: a redeploy changes every chunk's content hash. A tab that was already open
// still holds the old page shell, which names chunk filenames that no longer exist on the
// server, so the next lazy load — navigating to another doc, or pressing "Generate my key" on
// /signup — fails with the browser's own useless message, "Loading chunk 73 failed". The site
// is fine; that one tab is stale. A reload fixes it, but nobody outside this team knows that,
// and on /signup it reads as "the key generator is broken".
//
// So: reload once, automatically. The fresh page names the chunks that do exist.
//
// ONCE is the whole design. The sentinel is set BEFORE the reload, so a genuinely broken
// download — a dead network, a blocked CDN — cannot put the page in a loop; the second failure
// is left alone for the page's own error handling to show. sessionStorage, not localStorage:
// it is scoped to this tab and dies with it, which is exactly the lifetime of the problem.
// It holds nothing about the visitor.
const RELOADED = 'kakitu.chunkReload';

function isStaleChunkError(message: string): boolean {
  return /Loading chunk \S+ failed|Loading CSS chunk|ChunkLoadError|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

function reloadOnce(): void {
  try {
    if (sessionStorage.getItem(RELOADED)) {
      return;
    }
    sessionStorage.setItem(RELOADED, '1');
  } catch {
    // Private mode, or storage blocked: do nothing rather than risk a loop we cannot break.
    return;
  }
  window.location.reload();
}

export default function Root({children}: {children: React.ReactNode}): React.ReactElement {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isStaleChunkError(e.message ?? '')) {
        reloadOnce();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const message = typeof r === 'string' ? r : (r?.message ?? '');
      if (isStaleChunkError(message)) {
        reloadOnce();
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return <>{children}</>;
}
