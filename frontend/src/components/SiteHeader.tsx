import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight, Menu, Radio, X } from "lucide-react";
import { useExplorer } from "../store/explorer";
export function SiteHeader() {
  const slug = useExplorer((state) => state.selectedLocation);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape") setMenuOpen(false);
      }}
    >
      <Link className="brand" to="/">
        <Radio size={24} />
        FLAGWA
      </Link>
      <button
        type="button"
        className="icon-button site-menu-toggle"
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        title={menuOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={menuOpen}
        aria-controls="primary-navigation"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {menuOpen ? <X size={21} /> : <Menu size={21} />}
      </button>
      <nav
        id="primary-navigation"
        className={menuOpen ? "is-open" : ""}
        aria-label="Primary"
        onClick={() => setMenuOpen(false)}
      >
        <NavLink to="/" end>
          Story
        </NavLink>
        <NavLink to={`/explore/${slug}`}>Explore</NavLink>
        <NavLink className="earthscore-nav" to={`/earthscore/${slug}`}>
          THE EARTHSCORE
        </NavLink>
        <NavLink className="groundwire-nav" to="/groundwire">
          Groundwire
        </NavLink>
        <NavLink to="/radar-lab">Radar Lab</NavLink>
        <NavLink to="/about">About</NavLink>
      </nav>
      <Link className="header-cta" to={`/explore/${slug}`}>
        Open explorer <ArrowUpRight size={16} />
      </Link>
    </header>
  );
}
