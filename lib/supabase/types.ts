export type ShowroomImage = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
