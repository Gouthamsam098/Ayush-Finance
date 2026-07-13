import { LucideIcon } from 'lucide-react';

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-3xl backdrop-blur-sm p-6 h-full flex flex-col justify-start gap-3 border border-white/20" style={{ background: 'rgba(255, 255, 255, 0.80)' }}>
      <Icon className="w-6 h-6 text-emerald-600" strokeWidth={2} />
      <div>
        <h3 className="font-bold text-slate-900 text-sm leading-tight">{title}</h3>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
