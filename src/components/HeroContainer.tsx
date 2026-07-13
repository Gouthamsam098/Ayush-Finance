import Logo from './Logo';
import HeroHeading from './HeroHeading';
import LoanTypes from './LoanTypes';
import FeatureSection from './FeatureSection';
import LoanTypeCards from './LoanTypeCards';

export default function HeroContainer() {
  return (
    <div className="relative w-full h-full flex flex-col p-8 md:p-12 lg:p-16 overflow-hidden">
      {/* Top Section - Logo, Heading, Subtitle */}
      <div className="max-w-2xl z-10 mb-8">
        <div className="mb-6">
          <Logo size="md" />
        </div>

        <div className="space-y-8 max-w-lg">
          <HeroHeading />
          <LoanTypes />
        </div>
      </div>

      {/* Loan Type Cards - positioned in center area */}
      <LoanTypeCards />

      {/* Center Anchor Container - All floating cards orbit around shield */}
      <div className="relative flex-1 overflow-hidden">
        {/* FloatingLoanGroup - positioned in top-right area */}
        <div className="absolute w-96 h-96 pointer-events-none" style={{
          top: '18%',
          right: '8%',
        }}>
          {/* Shield - centered at anchor point */}
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="w-48 h-48 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-3xl shadow-2xl flex items-center justify-center animate-float" style={{
              boxShadow: '0 20px 60px rgba(16, 185, 129, 0.3)',
            }}>
              <svg className="w-32 h-32 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
            </div>
          </div>

        </div>

        {/* Family, Car, Bike, Tractor - positioned below shield */}
        <div className="absolute inset-0 flex items-end justify-center pointer-events-none z-15">
          {/* These are part of background image, this is just spacing placeholder */}
        </div>
      </div>

      {/* Bottom Feature Cards - positioned below family */}
      <div className="mt-auto pt-20 z-40">
        <FeatureSection />
      </div>
    </div>
  );
}
