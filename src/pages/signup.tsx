import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

import styles from './signup.module.css';

// Merchant sign-up moved to kakitu.org/merchant (founder decision, 2026-11-22). A shop's wallet
// is made in the Kakitu app and restored in the Kakitu extension; no website makes a wallet or
// shows its recovery phrase. This route stays so that old links still land somewhere useful.
const MERCHANT_URL = 'https://kakitu.org/merchant';

export default function SignupPage() {
  return (
    <Layout title="Become a merchant" description="Merchant sign-up is at kakitu.org/merchant.">
      <main className={styles.page}>
        <h1>Merchant sign-up moved to kakitu.org/merchant</h1>
        <p className={styles.lede}>
          Create your business wallet in the Kakitu app, add it to the Kakitu extension in Chrome,
          then sign in at kakitu.org/merchant and apply. Kakitu reviews every application.
        </p>
        <div className={styles.actions}>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href={MERCHANT_URL}>
            Go to kakitu.org/merchant
          </a>
          <Link className={`${styles.btn} ${styles.btnSecondary}`} to="/docs/quickstart">
            Read the quickstart
          </Link>
        </div>
        <p className={styles.hint}>
          Kakitu will never ask for your 12 words on a website, in an email or in a ticket.
        </p>
      </main>
    </Layout>
  );
}
