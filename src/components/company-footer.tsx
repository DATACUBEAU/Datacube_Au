import { Icons } from '@/components/icons';

type CompanyFooterProps = {
  productName?: string;
  ownershipLabel?: 'Built by' | 'A product of';
  className?: string;
};

const COMPANY_NAME = 'Zahed Investment Ltd';
const COMPANY_RC = '8127949';

export function CompanyFooter({
  productName = 'Datacube AU',
  ownershipLabel = 'Built by',
  className = '',
}: CompanyFooterProps) {
  return (
    <footer className={`w-full border-t border-border/40 ${className}`.trim()}>
      <div className="container py-6">
        <div className="flex items-start justify-center gap-3 md:justify-start">
          <Icons.logo className="mt-0.5 h-6 w-6 text-primary" />
          <div className="text-center text-sm text-muted-foreground md:text-left">
            <p className="font-semibold text-foreground">{productName}</p>
            <p>{ownershipLabel} {COMPANY_NAME}</p>
            <p>RC {COMPANY_RC}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}

