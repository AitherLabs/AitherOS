import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — AitherOS',
  robots: {
    index: false
  }
};

export default function PrivacyPolicyPage() {
  return (
    <div className='min-h-screen px-4 py-12 sm:px-6 lg:px-8'>
      <div className='mx-auto max-w-3xl space-y-8'>
        <h1 className='text-foreground text-3xl font-bold'>Privacy Policy</h1>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Introduction</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            This Privacy Policy explains how AitherOS, operated by AitherLabs,
            handles your information when you use our platform. We are committed
            to protecting your privacy and being transparent about our data
            practices.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Data Collection</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            AitherOS collects the minimum data necessary for authentication and
            platform operation: your email address, username, and display name.
            Agent configurations, workforce definitions, and execution data are
            stored to provide the orchestration service.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Authentication</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            Authentication is handled via JWT tokens issued by our backend.
            Passwords are hashed with bcrypt and never stored in plaintext.
            Session tokens are stored securely in HTTP-only cookies.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>No Data Misuse</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            Your data is never sold, rented, or shared with third parties for
            marketing purposes. Agent prompts and execution data are processed
            only to fulfill your orchestration requests and are not used to
            train external models.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Contact</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            For questions about this Privacy Policy, contact us at{' '}
            <a
              href='mailto:aitherlabs.ops@gmail.com'
              className='text-primary font-medium hover:underline'
            >
              aitherlabs.ops@gmail.com
            </a>
            .
          </p>
        </section>

        <div className='border-border border-t pt-4'>
          <p className='text-muted-foreground text-sm'>Last updated: March 2026</p>
        </div>
      </div>
    </div>
  );
}
