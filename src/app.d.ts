// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// File System Access API types
	interface FileSystemFileHandle {
		kind: 'file';
		getFile(): Promise<File>;
		createWritable(): Promise<FileSystemWritableFileStream>;
		name: string;
	}

	interface FileSystemDirectoryHandle {
		kind: 'directory';
		name: string;
		getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
		getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
		values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
		entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
	}

	interface FileSystemWritableFileStream extends WritableStream {
		write(data: string | BufferSource | Blob): Promise<void>;
		close(): Promise<void>;
	}

	interface Window {
		showDirectoryPicker(options?: {
			id?: string;
			mode?: 'read' | 'readwrite';
			startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
		}): Promise<FileSystemDirectoryHandle>;
	}
}

export {};
