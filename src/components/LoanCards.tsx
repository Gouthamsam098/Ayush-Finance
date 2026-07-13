import { User, Bike, Building2, Leaf } from 'lucide-react';

const loanCardsData = [
  {
    id: 'personal',
    title: 'Personal Loan',
    description: 'Instant cash for your needs.',
    icon: User,
    color: 'bg-emerald-500',
    position: 'top-24 left-20',
  },
  {
    id: 'bike',
    title: 'Bike Loan',
    description: 'Ride your dream bike today.',
    icon: Bike,
    color: 'bg-blue-500',
    position: 'top-40 right-40',
  },
  {
    id: 'property',
    title: 'Property Loan',
    description: 'Unlock the value of your property.',
    icon: Building2,
    color: 'bg-orange-500',
    position: 'top-80 right-32',
  },
  {
    id: 'agriculture',
    title: 'Agriculture Loan',
    description: 'Empowering farmers, growing better.',
    icon: Leaf,
    color: 'bg-emerald-600',
    position: 'top-96 left-32',
  },
];

export default function LoanCards() {
  return (
    <>
      {loanCardsData.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.id}
            className={`hidden lg:flex absolute ${card.position} bg-white rounded-2xl p-4 shadow-lg flex-col justify-start gap-2 w-56 hover:shadow-xl transition-all duration-300 hover:scale-105 z-20`}
          >
            <div className="flex items-start gap-3">
              <div className={`grid h-9 w-9 place-items-center rounded-full ${card.color} text-white flex-shrink-0`}>
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 text-sm leading-tight">{card.title}</div>
                <div className="text-xs text-slate-600 mt-0.5 leading-tight">{card.description}</div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
