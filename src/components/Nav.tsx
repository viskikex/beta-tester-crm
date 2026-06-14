import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Nav() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="nav">
      <Link to="/" className="brand">
        Beta Tester CRM
      </Link>
      {user && (
        <div className="nav-links">
          {isAdmin ? (
            <>
              <NavLink to="/">Dashboard</NavLink>
              <NavLink to="/testers">Testers</NavLink>
              <NavLink to="/feedback">Triage</NavLink>
            </>
          ) : (
            <NavLink to="/my-feedback">My feedback</NavLink>
          )}
          <button
            className="link-btn"
            onClick={async () => {
              await signOut();
              navigate("/auth");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
