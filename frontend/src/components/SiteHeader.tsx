import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight, Radio } from "lucide-react";
import { useExplorer } from "../store/explorer";
export function SiteHeader() {
  const slug = useExplorer((state) => state.selectedLocation);
  return (
    <header className="site-header">
      <Link className="brand" to="/">
        <Radio size={24} />
        FLAGWA
      </Link>
      <nav aria-label="Primary">
        <NavLink to="/" end>
          Story
        </NavLink>
        <NavLink to={`/explore/${slug}`}>Explore</NavLink>
        <NavLink to="/radar-lab">Radar Lab</NavLink>
        <NavLink to="/about">About</NavLink>
      </nav>
      <Link className="header-cta" to={`/explore/${slug}`}>
        Open explorer <ArrowUpRight size={16} />
      </Link>
    </header>
  );
}
