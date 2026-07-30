export function TaskOwner({ owner }: { owner: string | null }) {
  if (!owner) return null;

  return (
    <span className="text-[10px] text-text-500" title={`Owned by ${owner}`}>
      Owner: {owner}
    </span>
  );
}
