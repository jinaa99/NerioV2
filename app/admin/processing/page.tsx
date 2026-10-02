import type { Metadata } from 'next';
import Processing from '@/components/admin/Processing';

export const metadata: Metadata = { title: 'Processing' };

export default function Page() {
  return <Processing />;
}
