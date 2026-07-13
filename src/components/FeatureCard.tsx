import { LucideIcon } from 'lucide-react';

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-xl p-6 h-full flex flex-col justify-start gap-4 border border-slate-200 hover:border-slate-300 transition-all duration-300 hover:shadow-md hover:-translate-y-1 group" style={{ background: 'rgba(255, 255, 255, 0.9)' }}>
      <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-slate-200 transition-colors">
        <Icon className="w-6 h-6 text-slate-700" strokeWidth={2} />
      </div>
      <div>
        <h3 className="font-bold text-slate-900 text-sm leading-tight">{title}</h3>
        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
