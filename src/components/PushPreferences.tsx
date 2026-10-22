"use client";
import { useEffect, useState } from "react";
function decode(value: string): ArrayBuffer { const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, character => character.charCodeAt(0)).buffer; }
export default function PushPreferences() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(true);
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(supported);
    if (!supported) { setBusy(false); setMessage("Ce navigateur ne prend pas en charge les alertes téléphone. Sur iPhone, ajoutez d’abord le site à l’écran d’accueil puis ouvrez-le depuis cette icône."); return; }
    void (async () => {
      try {
        const response = await fetch("/api/push/subscriptions", { cache: "no-store" }); const result = await response.json();
        if (!response.ok) throw Error(result.error || "Impossible de charger les alertes.");
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (mounted) { setPublicKey(result.publicKey); setActive(Boolean(subscription && result.endpoints.includes(subscription.endpoint))); if (!result.publicKey) setMessage("Les alertes téléphone seront disponibles prochainement."); }
      } catch (error) { if (mounted) setMessage(error instanceof Error ? error.message : "Alertes indisponibles."); }
      finally { if (mounted) setBusy(false); }
    })();
    return () => { mounted = false; };
  }, []);
  async function toggle() {
    if (!publicKey) return;
    setBusy(true); setMessage("");
    try {
      if (active) {
        const registration = await navigator.serviceWorker.getRegistration("/"); const subscription = await registration?.pushManager.getSubscription();
        if (subscription) { const response = await fetch("/api/push/subscriptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }); if (!response.ok) throw Error("Désactivation impossible. Réessayez."); await subscription.unsubscribe(); }
        setActive(false); setMessage("Alertes désactivées sur cet appareil."); return;
      }
      // Only a direct user click may request permission; never ask on page load.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw Error("Autorisez les notifications dans les réglages de votre navigateur pour activer ces alertes.");
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(publicKey) });
      const response = await fetch("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      if (!response.ok) { const result = await response.json(); throw Error(result.error || "Activation impossible."); }
      setActive(true); setMessage("Vous recevrez les Flash sur cet appareil.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Activation impossible. Réessayez."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="phone-alerts-heading" className="mt-8 rounded-xl border border-border bg-card p-5"><h2 id="phone-alerts-heading" className="text-xl font-bold text-foreground">Alertes sur mon téléphone</h2><p className="my-3 text-sm text-muted-foreground">Recevez les informations Flash publiées par la rédaction. Activation volontaire, désactivable à tout moment sur chaque appareil.</p><button type="button" aria-pressed={active} disabled={busy || !supported || !publicKey} onClick={() => void toggle()} className="min-h-11 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-bold text-foreground disabled:opacity-60">{busy ? "Chargement…" : active ? "Désactiver les alertes sur cet appareil" : "Recevoir les alertes sur mon téléphone"}</button><p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p></section>;
}
