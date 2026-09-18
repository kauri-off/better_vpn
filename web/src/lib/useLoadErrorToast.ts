import { useEffect } from "react";
import { toast } from "sonner";

export function useLoadErrorToast(error: { message: string } | null | undefined, id: string) {
  useEffect(() => {
    if (error) toast.error(error.message, { id });
  }, [error, id]);
}
