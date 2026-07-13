import { User, Bike, Zap, Building2, Leaf } from 'lucide-react';

const loanCardsData = [
  {
    id: 'personal',
    title: 'Personal Loan',
    description: 'Instant cash for your needs.',
    icon: User,
    color: 'bg-slate-700',
    position: {
      top: '50%',
      left: '50%',
      transform: 'translate(calc(-50% - 180px), calc(-50% - 140px))',
    },
    animationDelay: '0s',
  },
  {
    id: 'bike',
    title: 'Bike Loan',
    description: 'Ride your dream bike today.',
    icon: Bike,
    color: 'bg-slate-700',
    position: {
      top: '50%',
      left: '50%',
      transform: 'translate(calc(-50% + 120px), calc(-50% - 140px))',
    },
    animationDelay: '0.8s',
  },
  {
    id: 'flexible',
    title: 'Flexible Loan',
    description: 'Funds for every opportunity.',
    icon: Zap,
    color: 'bg-slate-700',
    position: {
      top: '50%',
      left: '50%',
      transform: 'translate(calc(-50% - 180px), calc(-50% + 20px))',
    },
    animationDelay: '1.6s',
  },
  {
    id: 'property',
    title: 'Property Loan',
    description: 'Unlock the value of your property.',
    icon: Building2,
    color: 'bg-slate-700',
    position: {
      top: '50%',
      left: '50%',
      transform: 'translate(calc(-50% + 120px), calc(-50% + 20px))',
    },
    animationDelay: '2.4s',
  },
  {
    id: 'agriculture',
    title: 'Agriculture Loan',
    description: 'Empowering farmers, growing better.',
    icon: Leaf,
    color: 'bg-slate-700',
    position: {
      top: '50%',
      left: '50%',
      transform: 'translate(calc(-50% + 60px), calc(-50% + 160px))',
    },
    animationDelay: '3.2s',
  },
];

export default function LoanTypeCards() {
  return (
    <>
      {/* Parent container centered on shield */}
      <div
        className="hidden lg:block absolute pointer-events-none"
        style={{
          top: '35%',
          left: '45%',
          width: '100%',
          height: '100%',
        }}
      >
        {/* Shield - static center point */}
        <div
          className="absolute z-10 flex items-center justify-center"
          style={{
            width: '170px',
            height: '170px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            animation: 'float 5s ease-in-out infinite',
          }}
        >
          <div
            className="w-full h-full bg-slate-800 rounded-3xl shadow-2xl flex items-center justify-center"
            style={{
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
            }}
          >
            <svg
              className="w-24 h-24 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
          </div>
        </div>

        {/* Floating Loan Cards orbiting around shield */}
        {loanCardsData.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              className="absolute z-20 bg-white rounded-2xl p-5 flex items-start gap-3 hover:shadow-lg transition-all duration-300 hover:-translate-y-2 border border-slate-200 group cursor-pointer"
              style={{
                width: '220px',
                height: '92px',
                top: card.position.top,
                left: card.position.left,
                transform: card.position.transform,
                boxShadow: '0 18px 45px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
                animation: `float 5s ease-in-out infinite`,
                animationDelay: card.animationDelay,
              }}
            >
              <div className={`grid h-12 w-12 place-items-center rounded-lg ${card.color} text-white flex-shrink-0 shadow-md group-hover:shadow-lg transition-shadow`}>
                <Icon size={24} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-900 text-sm leading-tight group-hover:text-slate-950 transition-colors">{card.title}</div>
                <div className="text-xs text-slate-600 mt-0.5 leading-tight">{card.description}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating animation styles */}
      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-8px);
          }
        }
      `}</style>
    </>
  );
}
