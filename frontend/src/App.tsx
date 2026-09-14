import "./styles/globals.css";
import { lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { apiJson, configureApi, onMutation } from "./lib/api";
import { getStoredIdentity, setStoredIdentity, setStoredName } from "./lib/identity-storage";
import { installHashLeaveGuard } from "./lib/leave-guard";
import { isKnownHashRoute, navigate, parseHash, type Route } from "./lib/routes";
import type { Identity } from "./lib/types";
import { ErrorState, LoadingState, Onboarding } from "./components/AppShell";

const HomeRoute = lazy(() => import("./routes/HomeRoute").then(module => ({ default: module.HomeRoute })));
const SettingsRoute = lazy(() => import("./routes/SettingsRoute").then(module => ({ default: module.SettingsRoute })));
const RecapRoute = lazy(() => import("./routes/RecapRoute").then(module => ({ default: module.RecapRoute })));
const CreateRoute = lazy(() => import("./routes/CreateRoute").then(module => ({ default: module.CreateRoute })));
const BillRoute = lazy(() => import("./routes/BillRoute").then(module => ({ default: module.BillRoute })));

// Install before the App's hash listener so browser Back is guarded before a
// route can paint. The guard itself remains idle until the verify screen opts in.
installHashLeaveGuard();

function hasSessionSecret(identity: Identity | null): boolean {
  return typeof identity?.secret === "string" && identity.secret.trim().length > 0;
}

function RouteFallback() {
  return <div className="route-fallback"><LoadingState label="Memuat halaman" rows={3} /></div>;
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => getStoredIdentity());
  const [route, setRoute] = useState<Route>(() => parseHash().route);
  const [generation, setGeneration] = useState(0);
  const authenticatedIdentity = hasSessionSecret(identity) ? identity : null;

  const updateIdentity = useCallback((next: Identity | null) => {
    setIdentity(next);
    setStoredIdentity(next);
    if (next) setStoredName(next.name);
  }, []);
  const logout = useCallback(() => { updateIdentity(null); navigate({ kind: "home" }, true); }, [updateIdentity]);
  const onMutationRefresh = useCallback(() => setGeneration(value => value + 1), []);

  useLayoutEffect(() => {
    // A legacy id is a public reference, not an authenticated session. Keep
    // it out of the shared API getter so public bill reads cannot accidentally
    // become id-only join/selection attempts (bug: v85 legacy recovery).
    configureApi(() => authenticatedIdentity);
  }, [authenticatedIdentity]);

  useEffect(() => onMutation(onMutationRefresh), [onMutationRefresh]);

  useEffect(() => {
    const win = window as Window & {
      apiJson?: typeof apiJson;
      renderVerify?: (payload: unknown, manual?: boolean) => void;
      __bagiinVerify?: { payload: unknown; manual?: boolean };
    };
    win.apiJson = apiJson;
    win.renderVerify = (payload, manual = false) => {
      win.__bagiinVerify = { payload, manual };
      startTransition(() => setRoute({ kind: "verify" }));
      if (location.hash !== "#/create/verify") navigate({ kind: "verify" });
      window.dispatchEvent(new CustomEvent("bagiin:render-verify", { detail: { payload, manual } }));
    };
    return () => {
      delete win.apiJson;
      delete win.renderVerify;
      delete win.__bagiinVerify;
    };
  }, []);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      if (!parsed.valid || !isKnownHashRoute(parsed.parts)) {
        navigate({ kind: "home" }, true);
        startTransition(() => setRoute({ kind: "home" }));
        return;
      }
      if (parsed.parts.length === 1 && parsed.parts[0] === "history") {
        navigate({ kind: "home" }, true);
        startTransition(() => setRoute({ kind: "home" }));
      } else {
        startTransition(() => setRoute(parsed.route));
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!authenticatedIdentity && ["settings", "recap", "create", "verify"].includes(route.kind)) {
      navigate({ kind: "home" }, true);
      // replaceState does not emit hashchange; update React state alongside
      // the canonical hash so a private legacy link cannot remain painted.
      startTransition(() => setRoute({ kind: "home" }));
    }
  }, [authenticatedIdentity, route.kind]);

  const content = useMemo(() => {
    if (!authenticatedIdentity) {
      if (route.kind === "bill") return <BillRoute billId={route.billId} identity={null} onIdentity={updateIdentity} />;
      return <Onboarding legacyIdentity={identity} onIdentity={updateIdentity} />;
    }
    switch (route.kind) {
      case "settings": return <SettingsRoute identity={authenticatedIdentity} onIdentity={updateIdentity} onLogout={logout} key={generation} />;
      case "recap": return <RecapRoute identity={authenticatedIdentity} key={generation} />;
      case "create": return <CreateRoute identity={authenticatedIdentity} />;
      case "verify": return <CreateRoute identity={authenticatedIdentity} initialVerify />;
      case "bill": return <BillRoute billId={route.billId} identity={authenticatedIdentity} onIdentity={updateIdentity} />;
      case "unknown": return null;
      default: return <HomeRoute identity={authenticatedIdentity} key={generation} />;
    }
  }, [authenticatedIdentity, generation, identity, logout, route, updateIdentity]);

  return <div className="app-root"><main id="app"><Suspense fallback={<RouteFallback />}>{content}</Suspense></main></div>;
}