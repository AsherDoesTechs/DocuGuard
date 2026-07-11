import React from "react";
import { Search } from "lucide-react";

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = "Search documents...",
  value = "",
  onChange,
  onSearch,
}) => {
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onSearch) {
      onSearch((e.target as HTMLInputElement).value);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyPress={handleKeyPress}
        className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary-600 focus:outline-none transition-colors bg-white"
      />
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
    </div>
  );
};
