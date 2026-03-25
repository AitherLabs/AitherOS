import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — AitherOS',
  robots: {
    index: false
  }
};

export default function TermsOfServicePage() {
  return (
    <div className='min-h-screen px-4 py-12 sm:px-6 lg:px-8'>
      <div className='mx-auto max-w-3xl space-y-8'>
        <div className='text-center'>
          <h1 className='text-foreground text-3xl font-bold'>Terms of Service</h1>
          <p className='text-muted-foreground mt-2 text-sm'>Last updated: March 2026</p>
        </div>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Introduction</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            Welcome to AitherOS. These Terms of Service govern your access to
            and use of the AitherOS platform operated by AitherLabs. By
            accessing or using this application, you agree to be bound by these
            terms.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Beta Status</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            AitherOS is currently in beta. Features, APIs, and data may change
            without notice. While we strive for stability, we do not guarantee
            uninterrupted availability during this period.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Acceptable Use</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            You agree to use AitherOS only for lawful purposes. You are
            responsible for the content of agent prompts, workforce objectives,
            and any data processed through your executions. Do not use the
            platform to generate harmful, abusive, or illegal content.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>No Warranty</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            This application is provided &ldquo;as is&rdquo; without warranties
            of any kind. We disclaim all warranties, including implied
            warranties of merchantability and fitness for a particular purpose.
            LLM outputs may be inaccurate; you are responsible for reviewing
            agent-generated content.
          </p>
        </section>

        <section>
          <h2 className='text-foreground mb-3 text-xl font-semibold'>Changes</h2>
          <p className='text-muted-foreground text-base leading-relaxed'>
            We reserve the right to modify these Terms at any time. Continued
            use of the platform after changes constitutes acceptance. For
            questions, contact{' '}
            <a
              href='mailto:aitherlabs.ops@gmail.com'
              className='text-primary font-medium hover:underline'
            >
              aitherlabs.ops@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
