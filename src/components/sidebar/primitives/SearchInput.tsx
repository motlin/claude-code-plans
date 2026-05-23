import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

export function SearchInput() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    void navigate({
      to: "/search",
      search: { q: query.trim(), mode: "titles" as const },
    });
    setQuery("");
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          className="w-full rounded-md border border-border-300/10 bg-bg-000/50 py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-text-500 focus:border-border-300/30"
        />
      </div>
    </form>
  );
}
