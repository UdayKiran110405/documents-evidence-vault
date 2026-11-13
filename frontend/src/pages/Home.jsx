import { Link } from "react-router-dom";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { ROUTES } from "../config/constants";
import "../styles/home.css";

function Home() {
  return (
    <section className="home-page">
      <div className="home-content">
        <div className="home-badge">
          <ShieldCheck size={15} />
          Multi-Region Evidence Protection
        </div>

        <h1>
          Your Documents.
          <br />
          <span>Always Protected.</span>
        </h1>

        <p className="home-description">
          A secure document evidence vault designed for integrity verification,
          multi-region replication, and reliable disaster recovery.
        </p>

        <div className="home-actions">
          <Link to={ROUTES.LOGIN} className="primary-action">
            Get Started
            <ArrowRight size={18} />
          </Link>

          <Link to={ROUTES.DASHBOARD} className="secondary-action">
            Explore Dashboard
          </Link>
        </div>

        <div className="home-highlights">
          <div>
            <strong>SHA-256</strong>
            <span>Integrity Verification</span>
          </div>

          <div>
            <strong>Multi-Region</strong>
            <span>Storage Replication</span>
          </div>

          <div>
            <strong>Disaster Recovery</strong>
            <span>Recovery Drills</span>
          </div>
        </div>
      </div>

      <div className="home-visual">
        <div className="visual-glow"></div>

        <div className="vault-card">
          <div className="vault-icon">
            <ShieldCheck size={54} />
          </div>

          <h2>Evidence Vault</h2>

          <p>Protection across regions</p>

          <div className="region-status">
            <span className="status-dot"></span>
            Mumbai Region
            <strong>Active</strong>
          </div>

          <div className="region-status">
            <span className="status-dot"></span>
            Singapore Region
            <strong>Synced</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Home;
