import { useState } from 'react';

interface Props {
  value?: string;       // ISO date YYYY-MM-DD; undefined = no selection
  clearLabel?: string;  // label on the clear button, e.g. "Ever" or "Now"
  onConfirm: (date: string | undefined) => void;
}

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function CalendarPicker({ value, clearLabel = 'Clear', onConfirm }: Props) {
  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  const initial = value ? new Date(value + 'T00:00:00') : today;
  const [viewYear, setViewYear]   = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [selected, setSelected]   = useState<string | undefined>(value);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Build grid: leading nulls + days + trailing nulls to complete the last row
  const cells: (number | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      className="mt-2 bg-[#0d0d14] border border-[#2a2a3a] rounded-xl p-3 shadow-xl select-none"
      style={{ width: '14rem' }}
    >
      {/* Month / year header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button" onClick={prevMonth}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#1e1e2e] text-[#a78bfa] cursor-pointer text-lg leading-none"
        >
          ‹
        </button>
        <span className="text-xs font-semibold text-white">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button" onClick={nextMonth}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#1e1e2e] text-[#a78bfa] cursor-pointer text-lg leading-none"
        >
          ›
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(d => (
          <span key={d} className="text-[9px] text-center text-[#4b5568] font-medium">{d}</span>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (day === null) return <span key={i} />;
          const iso       = toISO(viewYear, viewMonth, day);
          const isSelected = iso === selected;
          const isToday    = iso === todayISO;
          return (
            <button
              key={i} type="button"
              onClick={() => setSelected(iso)}
              className="h-6 rounded text-[10px] font-medium transition-all cursor-pointer"
              style={{
                backgroundColor: isSelected ? '#7c3aed' : 'transparent',
                color: isSelected ? '#fff' : isToday ? '#a78bfa' : '#94a3b8',
                outline: isToday && !isSelected ? '1px solid #4c1d95' : 'none',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Footer: clear + OK */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1e1e2e]">
        <button
          type="button"
          onClick={() => onConfirm(undefined)}
          className="text-[10px] text-[#4b5568] hover:text-[#a78bfa] cursor-pointer transition-colors"
        >
          {clearLabel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(selected)}
          className="px-3 py-1 rounded text-[10px] font-semibold bg-[#7c3aed] hover:bg-[#6d28d9] text-white cursor-pointer transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
}
