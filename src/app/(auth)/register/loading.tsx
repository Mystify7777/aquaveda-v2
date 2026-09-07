import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div className="mx-auto flex max-w-6xl justify-center px-4 py-16 sm:px-6 sm:py-24">
            <Skeleton className="h-[460px] w-full max-w-md rounded-xl" />
        </div>
    );
}
