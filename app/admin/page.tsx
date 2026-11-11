import { ADMIN_NAVIGATION } from "./_config/navigation";

export default function Page() {
  return (
    <h1 className="p-6 text-2xl font-semibold">
      관리자 {ADMIN_NAVIGATION.dashboard.label}
    </h1>
  );
}
