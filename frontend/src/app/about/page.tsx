import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — AitherOS'
};

export default function AboutPage() {
  return (
    <div className='bg-background text-foreground min-h-screen px-6 py-16'>
      <div className='mx-auto max-w-3xl space-y-10'>
        <section className='text-center'>
          <h1 className='text-foreground text-3xl font-bold tracking-tight sm:text-4xl'>
            About AitherOS
          </h1>
          <p className='text-muted-foreground mt-2 text-lg'>
            Autonomous AI workforce orchestration.
          </p>
        </section>

        <div className='space-y-8'>
          <section className='bg-card rounded-2xl border p-8 shadow-sm'>
            <h2 className='text-foreground mb-4 text-xl font-semibold'>
              What is AitherOS?
            </h2>
            <p className='text-muted-foreground text-lg leading-relaxed'>
              AitherOS is an autonomous AI workforce orchestration platform. It
              lets you create AI agents, assemble them into workforces, and
              launch multi-agent executions that plan, collaborate, and deliver
              results — all observable in real time.
            </p>
          </section>

          <section className='bg-card rounded-2xl border p-8 shadow-sm'>
            <h2 className='text-foreground mb-4 text-xl font-semibold'>
              How It Works
            </h2>
            <p className='text-muted-foreground text-lg leading-relaxed'>
              Configure agents with specific roles, strategies, and LLM models.
              Group them into workforces with shared objectives and token
              budgets. Launch executions where the orchestrator coordinates each
              agent&apos;s contributions, manages iterations, and produces
              consolidated results.
            </p>
          </section>

          <section className='bg-card rounded-2xl border p-8 shadow-sm'>
            <h2 className='text-foreground mb-4 text-xl font-semibold'>
              Built by AitherLabs
            </h2>
            <p className='text-muted-foreground text-lg leading-relaxed'>
              AitherOS is developed by AitherLabs. For questions or support,
              reach out at{' '}
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
    </div>
  );
}
