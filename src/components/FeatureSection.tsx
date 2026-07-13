import { Zap, ShieldCheck, FileText, Headphones } from 'lucide-react';
import FeatureCard from './FeatureCard';

const features = [
  {
    icon: Zap,
    title: 'Fast Approval',
    description: 'Quick loan decisions and faster disbursal.',
  },
  {
    icon: ShieldCheck,
    title: '100% Secure & Safe',
    description: 'Your information is protected with industry-grade security.',
  },
  {
    icon: FileText,
    title: 'Minimal Documentation',
    description: 'Simple process with fewer documents.',
  },
  {
    icon: Headphones,
    title: 'Trusted Support',
    description: 'Friendly support whenever you need assistance.',
  },
];

export default function FeatureSection() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 w-full mt-12 md:mt-16 pt-8 border-t border-white/20">
      {features.map((feature) => (
        <FeatureCard
          key={feature.title}
          icon={feature.icon}
          title={feature.title}
          description={feature.description}
        />
      ))}
    </div>
  );
}
