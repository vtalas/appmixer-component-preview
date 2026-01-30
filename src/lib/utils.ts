import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ComponentProps, Snippet } from 'svelte';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChild<T> = Omit<T, 'child' | 'children'> & {
	children?: Snippet;
};

export type WithoutChildrenOrChild<T> = Omit<T, 'child' | 'children'>;
