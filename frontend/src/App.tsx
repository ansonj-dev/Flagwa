import { Component, Suspense, lazy, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retryQuery } from "./services/data";
import { ErrorState, Loading } from "./components/ui";
const Story = lazy(() =>
  import("./pages/Story").then((module) => ({ default: module.Story })),
);
const Explorer = lazy(() =>
  import("./pages/Explorer").then((module) => ({ default: module.Explorer })),
);
const RadarLab = lazy(() =>
  import("./pages/RadarLab").then((module) => ({ default: module.RadarLab })),
);
const About = lazy(() =>
  import("./pages/About").then((module) => ({ default: module.About })),
);
const Earthscore = lazy(() =>
  import("./pages/Earthscore").then((module) => ({
    default: module.Earthscore,
  })),
);
const Groundwire = lazy(() =>
  import("./pages/Groundwire").then((module) => ({
    default: module.Groundwire,
  })),
);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: retryQuery, refetchOnWindowFocus: false },
  },
});
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <h1>FLAGWA could not render this view.</h1>
        <ErrorState error={this.state.error} />
        <a className="primary-button" href="/">
          Return to the story
        </a>
      </main>
    ) : (
      this.props.children
    );
  }
}
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!pathname.startsWith("/explore")) window.scrollTo(0, 0);
    document.title = pathname.startsWith("/explore")
      ? "Explore · FLAGWA"
      : pathname === "/radar-lab"
        ? "Radar Lab · FLAGWA"
        : pathname === "/groundwire"
          ? "Groundwire · FLAGWA"
          : pathname.startsWith("/earthscore")
            ? "THE EARTHSCORE · FLAGWA"
            : "FLAGWA · Global Surface Change Explorer";
  }, [pathname]);
  return null;
}
export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ScrollReset />
          <Suspense
            fallback={
              <main className="route-loading">
                <Loading label="Opening FLAGWA" />
              </main>
            }
          >
            <Routes>
              <Route path="/" element={<Story />} />
              <Route path="/stories" element={<Story />} />
              <Route path="/explore" element={<Explorer />} />
              <Route path="/explore/:locationSlug" element={<Explorer />} />
              <Route
                path="/explore/:locationSlug/compare"
                element={<Explorer />}
              />
              <Route
                path="/explore/:locationSlug/results/:resultId"
                element={<Explorer />}
              />
              <Route path="/radar-lab" element={<RadarLab />} />
              <Route path="/groundwire" element={<Groundwire />} />
              <Route path="/about" element={<About />} />
              <Route path="/earthscore" element={<Earthscore />} />
              <Route
                path="/earthscore/:locationSlug"
                element={<Earthscore />}
              />
              <Route
                path="/earthscore/:locationSlug/results/:resultId"
                element={<Earthscore />}
              />
              <Route
                path="*"
                element={
                  <main className="fatal-error">
                    <h1>Place not found.</h1>
                    <Link className="primary-button" to="/explore">
                      Return to explorer
                    </Link>
                  </main>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
