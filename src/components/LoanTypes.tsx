const loanTypes = ['Personal', 'Bike', 'Flexible', 'Property', 'Agriculture'];

export default function LoanTypes() {
  return (
    <div className="flex items-center flex-wrap gap-2 my-12 text-base font-medium text-slate-800 drop-shadow max-w-2xl">
      {loanTypes.map((type, index) => (
        <span key={type} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 bg-emerald-600 rounded-full flex-shrink-0"></span>
          <span className="whitespace-nowrap">{type}</span>
          {index < loanTypes.length - 1 && <span className="text-slate-600">•</span>}
        </span>
      ))}
    </div>
  );
}
