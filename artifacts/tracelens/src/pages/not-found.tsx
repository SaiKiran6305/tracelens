import { Link } from 'wouter';
import { btnPrimary, Eyebrow } from '@/components/bits';

export default function NotFound() {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-center">
      <div>
        <Eyebrow>404 · no evidence at this path</Eyebrow>
        <h1 className="mt-3 text-4xl font-bold">This route was never recorded.</h1>
        <p className="mt-2 text-muted-foreground">Nothing was observed here, so we will not pretend otherwise.</p>
        <Link href="/" className={btnPrimary + ' mt-6'} data-testid="link-not-found-home">Back to overview</Link>
      </div>
    </div>
  );
}
