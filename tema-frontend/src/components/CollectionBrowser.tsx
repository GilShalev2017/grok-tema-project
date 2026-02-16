// // src/components/CollectionBrowser.tsx
// import { useState } from "react";
// import { useItems, useImportMet, useEnrichItem } from "@/hooks/useCollection";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import {
//   Popover,
//   PopoverContent,
//   PopoverTrigger,
// } from "@/components/ui/popover";
// import {
//   Command,
//   CommandEmpty,
//   CommandGroup,
//   CommandInput,
//   CommandItem,
//   CommandList,
// } from "@/components/ui/command";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Badge } from "@/components/ui/badge";
// import { Skeleton } from "@/components/ui/skeleton";
// import {
//   Check,
//   ChevronsUpDown,
//   RefreshCw,
//   Search,
//   Sparkles,
// } from "lucide-react";
// import { toast } from "@/hooks/use-toast"; // or "@/components/ui/use-toast"
// import { cn } from "@/lib/utils";

// export default function CollectionBrowser() {
//   const { data: items = [], isLoading } = useItems();
//   const importMutation = useImportMet();
//   const enrichMutation = useEnrichItem();

//   // State
//   const [searchKeyword, setSearchKeyword] = useState<string>("");
//   const [open, setOpen] = useState(false);
//   const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

//   // Met departments (partial list)
//   const departments = [
//     { value: "1", label: "American Decorative Arts" },
//     { value: "3", label: "Ancient Near Eastern Art" },
//     { value: "6", label: "Arms and Armor" },
//     { value: "8", label: "Asian Art" },
//     { value: "9", label: "Drawings and Prints" },
//     { value: "10", label: "Egyptian Art" },
//     { value: "11", label: "European Paintings" },
//     { value: "12", label: "European Sculpture and Decorative Arts" },
//     { value: "13", label: "Greek and Roman Art" },
//     { value: "14", label: "Islamic Art" },
//     { value: "17", label: "Medieval Art" },
//     { value: "21", label: "Photographs" },
//     { value: "22", label: "Robert Lehman Collection" },
//   ];

//   const handleImport = () => {
//     const keyword = searchKeyword.trim() || "*";

//     importMutation.mutate(
//       {
//         searchTerm: keyword,
//         departmentIds: selectedDepartments,
//       },
//       {
//         onSuccess: (response) => {
//           const data = response.data;
//           toast({
//             title: "Import Completed",
//             description: `Added ${data.imported} new items (out of ${data.totalFound} found). Keyword: "${keyword}"`,
//             duration: 6000,
//           });
//         },
//         onError: (err: any) => {
//           toast({
//             title: "Import Failed",
//             description: err.message || "Something went wrong. Try again.",
//             variant: "destructive",
//           });
//         },
//       },
//     );
//   };

//   const handleEnrich = (itemId: string, title: string) => {
//     enrichMutation.mutate(itemId, {
//       onSuccess: () => {
//         toast({
//           title: "AI Enrichment Done",
//           description: `Keywords added to "${title}"`,
//         });
//       },
//       onError: () => {
//         toast({
//           title: "Enrichment Failed",
//           description: "AI service error. Try later.",
//           variant: "destructive",
//         });
//       },
//     });
//   };

//   return (
//     <div className="container mx-auto py-10 px-4 max-w-screen-2xl">
//       {/* Controls */}
//       <div className="flex flex-col gap-6 mb-10">
//         <h1 className="text-4xl font-bold tracking-tight">
//           Collection Browser
//         </h1>

//         <div className="flex flex-col sm:flex-row gap-4 items-end">
//           {/* Keyword Search */}
//           <div className="flex-1 relative">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
//             <Input
//               placeholder="Keyword (e.g. portrait, landscape, dog, impressionism...)"
//               value={searchKeyword}
//               onChange={(e) => setSearchKeyword(e.target.value)}
//               className="pl-10"
//               onKeyDown={(e) => e.key === "Enter" && handleImport()}
//             />
//           </div>

//           {/* Multi-select Departments */}
//           <div className="w-full sm:w-80">
//             <Popover open={open} onOpenChange={setOpen}>
//               <PopoverTrigger asChild>
//                 <Button
//                   variant="outline"
//                   role="combobox"
//                   aria-expanded={open}
//                   className="w-full justify-between"
//                 >
//                   {selectedDepartments.length === 0
//                     ? "All Departments"
//                     : `${selectedDepartments.length} selected`}
//                   <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
//                 </Button>
//               </PopoverTrigger>
//               <PopoverContent className="w-full p-0">
//                 <Command>
//                   <CommandInput placeholder="Search department..." />
//                   <CommandList>
//                     <CommandEmpty>No department found.</CommandEmpty>
//                     <CommandGroup>
//                       {departments.map((dep) => (
//                         <CommandItem
//                           key={dep.value}
//                           value={dep.label}
//                           onSelect={() => {
//                             setSelectedDepartments((prev) =>
//                               prev.includes(dep.value)
//                                 ? prev.filter((v) => v !== dep.value)
//                                 : [...prev, dep.value],
//                             );
//                             setOpen(false);
//                           }}
//                         >
//                           <Check
//                             className={cn(
//                               "mr-2 h-4 w-4",
//                               selectedDepartments.includes(dep.value)
//                                 ? "opacity-100"
//                                 : "opacity-0",
//                             )}
//                           />
//                           {dep.label}
//                         </CommandItem>
//                       ))}
//                     </CommandGroup>
//                   </CommandList>
//                 </Command>
//               </PopoverContent>
//             </Popover>
//           </div>

//           {/* Import Button */}
//           <Button
//             onClick={handleImport}
//             disabled={importMutation.isPending}
//             className="w-full sm:w-auto min-w-[160px]"
//           >
//             {importMutation.isPending ? (
//               <>
//                 <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
//                 Importing...
//               </>
//             ) : (
//               <>
//                 <RefreshCw className="mr-2 h-4 w-4" />
//                 Import from Met
//               </>
//             )}
//           </Button>
//         </div>
//       </div>

//       {/* Items Grid - 6 columns on large screens */}
//       {isLoading ? (
//         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-6">
//           {[...Array(12)].map((_, i) => (
//             <Skeleton key={i} className="h-96 w-full rounded-xl" />
//           ))}
//         </div>
//       ) : items.length === 0 ? (
//         <div className="text-center py-20 text-muted-foreground text-lg">
//           No items in collection yet.
//           <br />
//           Try importing with a keyword or department.
//         </div>
//       ) : (
//         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-6">
//           {items.map((item: any) => (
//             <Card
//               key={item.id}
//               className="overflow-hidden hover:shadow-xl transition-all duration-200 border-border/50 flex flex-col"
//             >
//               <div className="relative aspect-[4/3] bg-muted flex-shrink-0">
//                 {item.imageUrl ? (
//                   <img
//                     src={item.imageUrl}
//                     alt={item.title}
//                     className="absolute inset-0 w-full h-full object-cover transition-transform hover:scale-105"
//                     loading="lazy"
//                     decoding="async"
//                     onError={(e) => {
//                       e.currentTarget.src =
//                         "https://placehold.co/600x450?text=Image+Not+Found";
//                       e.currentTarget.classList.add("opacity-70");
//                     }}
//                   />
//                 ) : (
//                   <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60 text-sm">
//                     No Image Available
//                   </div>
//                 )}
//               </div>

//               <CardHeader className="pb-2 pt-4 flex-grow">
//                 <CardTitle className="line-clamp-2 text-lg leading-tight">
//                   {item.title}
//                 </CardTitle>
//                 <p className="text-sm text-muted-foreground mt-1">
//                   {item.artist || "Unknown artist"}
//                   {item.year ? ` (${item.year})` : ""}
//                 </p>
//               </CardHeader>

//               <CardContent className="pt-0 mt-auto">
//                 <div className="flex flex-wrap gap-1.5 mb-4 min-h-[1.5rem]">
//                   {item.aiKeywords?.length > 0 ? (
//                     item.aiKeywords.slice(0, 6).map((kw: string) => (
//                       <Badge key={kw} variant="secondary" className="text-xs">
//                         {kw}
//                       </Badge>
//                     ))
//                   ) : (
//                     <span className="text-xs text-muted-foreground italic">
//                       No AI tags yet
//                     </span>
//                   )}
//                 </div>

//                 <Button
//                   variant="outline"
//                   size="sm"
//                   onClick={() => handleEnrich(item.id, item.title)}
//                   disabled={enrichMutation.isPending}
//                   className="w-full text-sm"
//                 >
//                   <Sparkles className="mr-2 h-4 w-4" />
//                   {enrichMutation.isPending ? "Enriching..." : "Enrich with AI"}
//                 </Button>
//               </CardContent>
//             </Card>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }

// src/components/CollectionBrowser.tsx
import { useState } from "react";
import { useItems, useImportMet, useEnrichItem } from "@/hooks/useCollection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  ChevronsUpDown,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function CollectionBrowser() {
  const { data: items = [], isLoading } = useItems();
  const importMutation = useImportMet();
  const enrichMutation = useEnrichItem();

  // State
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  // Met departments (partial list)
  const departments = [
    { value: "1", label: "American Decorative Arts" },
    { value: "3", label: "Ancient Near Eastern Art" },
    { value: "6", label: "Arms and Armor" },
    { value: "8", label: "Asian Art" },
    { value: "9", label: "Drawings and Prints" },
    { value: "10", label: "Egyptian Art" },
    { value: "11", label: "European Paintings" },
    { value: "12", label: "European Sculpture and Decorative Arts" },
    { value: "13", label: "Greek and Roman Art" },
    { value: "14", label: "Islamic Art" },
    { value: "17", label: "Medieval Art" },
    { value: "21", label: "Photographs" },
    { value: "22", label: "Robert Lehman Collection" },
  ];

  const handleImport = () => {
    const keyword = searchKeyword.trim() || "*";

    importMutation.mutate(
      {
        searchTerm: keyword,
        departmentIds: selectedDepartments,
      },
      {
        onSuccess: (response) => {
          const data = response.data; // axios response shape
          toast({
            title: "Import Completed",
            description: `Added ${data.imported} new items (out of ${data.totalFound} found). Keyword: "${keyword}"`,
            duration: 6000,
          });
        },
        onError: (err: any) => {
          toast({
            title: "Import Failed",
            description: err.message || "Something went wrong. Try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleEnrich = (itemId: string, title: string) => {
    enrichMutation.mutate(itemId, {
      onSuccess: () => {
        toast({
          title: "AI Enrichment Done",
          description: `Keywords added to "${title}"`,
        });
      },
      onError: () => {
        toast({
          title: "Enrichment Failed",
          description: "AI service error. Try later.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="min-h-screen bg-background w-screen">
      <div className="mx-auto max-w-screen-2xl px-6 sm:px-10 lg:px-16 xl:px-20 2xl:px-24">
        {/* Header & Controls */}
        <div className="mb-10 flex flex-col gap-6">
          <h1 className="text-4xl font-bold tracking-tight text-center sm:text-left">
            Collection Browser
          </h1>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            {/* Keyword Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Keyword (e.g. portrait, landscape, dog, impressionism...)"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="pl-10"
                onKeyDown={(e) => e.key === "Enter" && handleImport()}
              />
            </div>

            {/* Departments Multi-select */}
            <div className="w-full sm:w-80">
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                  >
                    {selectedDepartments.length === 0
                      ? "All Departments"
                      : `${selectedDepartments.length} selected`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Search department..." />
                    <CommandList>
                      <CommandEmpty>No department found.</CommandEmpty>
                      <CommandGroup>
                        {departments.map((dep) => (
                          <CommandItem
                            key={dep.value}
                            value={dep.label}
                            onSelect={() => {
                              setSelectedDepartments((prev) =>
                                prev.includes(dep.value)
                                  ? prev.filter((v) => v !== dep.value)
                                  : [...prev, dep.value],
                              );
                              setOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedDepartments.includes(dep.value)
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {dep.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Import Button */}
            <Button
              onClick={handleImport}
              disabled={importMutation.isPending}
              className="w-full sm:w-auto min-w-[160px]"
            >
              {importMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Import from Met
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Items Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-6">
            {[...Array(12)].map((_, i) => (
              <Skeleton key={i} className="h-96 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-lg">
            No items in collection yet.
            <br />
            Try importing with a keyword or department.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-6">
            {items.map((item: any) => (
              <Card
                key={item.id}
                className="overflow-hidden hover:shadow-xl transition-all duration-200 border-border/50 flex flex-col"
              >
                <div className="relative aspect-[4/3] bg-muted flex-shrink-0">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform hover:scale-105"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.src =
                          "https://placehold.co/600x450?text=Image+Not+Found";
                        e.currentTarget.classList.add("opacity-70");
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60 text-sm">
                      No Image Available
                    </div>
                  )}
                </div>

                <CardHeader className="pb-2 pt-4 flex-grow">
                  <CardTitle className="line-clamp-2 text-lg leading-tight">
                    {item.title}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.artist || "Unknown artist"}
                    {item.year ? ` (${item.year})` : ""}
                  </p>
                </CardHeader>

                <CardContent className="pt-0 mt-auto">
                  <div className="flex flex-wrap gap-1.5 mb-4 min-h-[1.5rem]">
                    {item.aiKeywords?.length > 0 ? (
                      item.aiKeywords.slice(0, 6).map((kw: string) => (
                        <Badge key={kw} variant="secondary" className="text-xs">
                          {kw}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        No AI tags yet
                      </span>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEnrich(item.id, item.title)}
                    disabled={enrichMutation.isPending}
                    className="w-full text-sm"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {enrichMutation.isPending
                      ? "Enriching..."
                      : "Enrich with AI"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
