import type { DJPreferences, VenueType, AudienceAgeRange, AudiencePurpose, OccasionType } from '../types';

interface Props {
  prefs: DJPreferences;
  availableGenres: string[];
  onChange: (prefs: DJPreferences) => void;
  onGenerate: () => void;
  disabled: boolean;
}

const VENUE_TYPES: VenueType[] = ['Club', 'Bar', 'Festival', 'Private event', 'Corporate', 'Wedding'];
const AGE_RANGES: AudienceAgeRange[] = ['18–25', '25–35', '35–50', 'Mixed'];
const PURPOSES: AudiencePurpose[] = ['Dancing', 'Background', 'Celebration', 'Mixed'];
const OCCASIONS: OccasionType[] = [
  'Birthday', 'Weekend night', 'Midweek', 'After-party', 'Warm-up', 'Peak time', 'Cool-down',
];

const labelClass = 'block text-xs font-medium text-[#94a3b8] mb-1 uppercase tracking-wide';
const inputClass =
  'w-full bg-[#0d0d14] border border-[#2a2a3a] rounded-md px-3 py-2 text-sm text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] transition-colors';

export default function PreferencesForm({ prefs, availableGenres, onChange, onGenerate, disabled }: Props) {
  function set<K extends keyof DJPreferences>(key: K, value: DJPreferences[K]) {
    onChange({ ...prefs, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>Set Duration (minutes)</label>
        <input
          type="number"
          min={10}
          max={600}
          value={prefs.setDuration}
          onChange={(e) => set('setDuration', Math.max(1, parseInt(e.target.value) || 60))}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Venue Type</label>
        <select
          value={prefs.venueType}
          onChange={(e) => set('venueType', e.target.value as VenueType)}
          className={inputClass}
        >
          {VENUE_TYPES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Audience Age Range</label>
        <select
          value={prefs.audienceAgeRange}
          onChange={(e) => set('audienceAgeRange', e.target.value as AudienceAgeRange)}
          className={inputClass}
        >
          {AGE_RANGES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Audience Purpose</label>
        <select
          value={prefs.audiencePurpose}
          onChange={(e) => set('audiencePurpose', e.target.value as AudiencePurpose)}
          className={inputClass}
        >
          {PURPOSES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Occasion Type</label>
        <select
          value={prefs.occasionType}
          onChange={(e) => set('occasionType', e.target.value as OccasionType)}
          className={inputClass}
        >
          {OCCASIONS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Genre</label>
        <select
          value={prefs.genre}
          onChange={(e) => set('genre', e.target.value)}
          className={inputClass}
        >
          <option value="Any">Any</option>
          {availableGenres.map((genre) => (
            <option key={genre} value={genre}>{genre}</option>
          ))}
        </select>
      </div>

      <button
        onClick={onGenerate}
        disabled={disabled}
        className="mt-2 w-full bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-md transition-colors cursor-pointer"
      >
        Generate Set
      </button>
    </div>
  );
}
