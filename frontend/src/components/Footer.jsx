
import { ShieldCheck } from 'lucide-react';
import { APP_CONFIG } from '../config/constants';
import '../styles/footer.css';

function Footer() {

    return (
        <footer className="footer">

            <div className="footer-brand">
                <ShieldCheck size={18} />
                <span>{APP_CONFIG.APP_NAME}</span>
            </div>

            <p>
                Secure storage. Verified integrity. Reliable recovery.
            </p>

            <span className="footer-copyright">
                © {new Date().getFullYear()} EvidenceVault
            </span>

        </footer>
    );
}

export default Footer;
