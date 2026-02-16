import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getItems, importMet, enrichItem } from "@/api/api";

export function useItems() {
  return useQuery({
    queryKey: ["items"],
    queryFn: () => getItems().then((res) => res.data),
  });
}

export function useImportMet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      searchTerm = "*",
      departmentIds = [],
    }: {
      searchTerm?: string;
      departmentIds?: string[];
    }) => importMet(searchTerm, departmentIds),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useEnrichItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => enrichItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}
