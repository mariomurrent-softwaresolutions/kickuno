"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const COOKIE_NAME = "kickuno_cookie_notice";
const STORAGE_KEY = "kickuno_cookie_notice_accepted";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function hasCookie(name: string): boolean {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${name}=`));
}

function isCookieNoticeAccepted(): boolean {
  try {
    if (hasCookie(COOKIE_NAME)) return true;
  } catch {
    // Ignore cookie read failures and continue with storage fallback.
  }

  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Some environments block storage access; fallback to "not accepted".
    return false;
  }
}

function persistCookieNoticeAcceptance() {
  const expiresAt = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000).toUTCString();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  try {
    document.cookie = `${COOKIE_NAME}=acknowledged; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Expires=${expiresAt}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Ignore cookie write failures; local storage may still persist acceptance.
  }

  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Cookie alone is enough for core behavior when storage is unavailable.
  }
}

export function CookieBanner() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const accepted = isCookieNoticeAccepted();
    setVisible(!accepted);
  }, []);

  function acknowledge() {
    // Hide immediately even in restricted browser/privacy contexts.
    setVisible(false);

    try {
      persistCookieNoticeAcceptance();
    } catch {
      // Intentionally ignore persistence failures.
    }
  }

  if (!visible) return null;
  return (
    <aside className="cookieBanner" aria-label="Cookie-Hinweis">
      <div>
        <span>Cookie-Hinweis</span>
        <p>Kickuno verwendet ein einziges technisch notwendiges Cookie, um diesen Hinweis zu merken. Keine Analyse- oder Werbe-Cookies.</p>
      </div>
      <Link href="/privacy">Details zum Datenschutz</Link>
      <button type="button" onClick={acknowledge}>Verstanden</button>
    </aside>
  );
}
