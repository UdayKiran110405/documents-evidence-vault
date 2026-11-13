import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

function Unauthorized() {
  return (
    <div className="placeholder-page">
      <ShieldAlert size={42} color="var(--danger)" />

      <h1>Access Denied</h1>

      <p>You do not have permission to access this section.</p>

      <Link to="/dashboard">Return to Dashboard</Link>
    </div>
  );
}

export default Unauthorized;
