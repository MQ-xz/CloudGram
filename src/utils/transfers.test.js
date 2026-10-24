import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../redux/store";

const { telegram, Api } = vi.hoisted(() => {
    const type = (kind) =>
        class {
            constructor(value) {
                Object.assign(this, value, { kind });
            }
        };
    return {
        telegram: {},
        Api: {
            upload: {
                SaveFilePart: type("part"),
                SaveBigFilePart: type("big-part"),
            },
            InputFile: type("file"),
            InputFileBig: type("big-file"),
        },
    };
});
vi.mock("../services/telegram", () => ({ default: telegram }));
vi.mock("telegram", () => ({
    Api,
    helpers: { generateRandomLong: () => 123n },
}));
import uploadFile from "./uploadFile";
import downloadFile, { streamingThreshold } from "./downloadFile";

const bytes = new TextEncoder().encode("hello");
const documentMessage = (size = bytes.length) => ({
    id: 55,
    media: { document: { size: BigInt(size), mimeType: "text/plain" } },
});
function chunks(values = [bytes]) {
    return {
        async *[Symbol.asyncIterator]() {
            for (const value of values) yield value;
        },
        close: vi.fn().mockResolvedValue(undefined),
    };
}
function file(size = bytes.length) {
    return {
        name: "notes.txt",
        size,
        arrayBuffer: vi.fn(() => {
            throw new Error("Whole-file reads are forbidden");
        }),
        slice: vi.fn((start, end) => ({
            arrayBuffer: async () => new Uint8Array(end - start).buffer,
        })),
    };
}
beforeEach(() => {
    Store.dispatch({ type: "LOGOUT_SUCCESS" });
    Object.assign(telegram, {
        invoke: vi.fn().mockResolvedValue(true),
        sendFile: vi.fn().mockResolvedValue({ id: 99 }),
        getMessages: vi.fn().mockResolvedValue([documentMessage()]),
        iterDownload: vi.fn(() => chunks()),
    });
    Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        writable: true,
        value: undefined,
    });
    URL.createObjectURL = vi.fn(() => "blob:verification");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("chunked uploads", () => {
    it("sends file parts before creating the Saved Messages document", async () => {
        const source = file();
        expect(await uploadFile("upload", source)).toEqual({ id: 99 });
        expect(telegram.invoke.mock.calls[0][0]).toMatchObject({
            kind: "part",
            fileId: 123n,
            filePart: 0,
        });
        expect(telegram.sendFile.mock.calls[0][1].file).toMatchObject({
            kind: "file",
            parts: 1,
            name: "notes.txt",
        });
        expect(source.arrayBuffer).not.toHaveBeenCalled();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
    it("uploads files larger than the SDK's buffering threshold with bounded reads", async () => {
        const source = file(36 * 1024 * 1024 + 3);
        let sent = 0,
            largest = 0;
        telegram.invoke = async (request) => {
            sent++;
            largest = Math.max(largest, request.bytes.length);
            expect(request.kind).toBe("big-part");
            expect(request.fileTotalParts).toBe(73);
            return true;
        };
        await uploadFile("large", source);
        expect(sent).toBe(73);
        expect(largest).toBe(512 * 1024);
        expect(source.arrayBuffer).not.toHaveBeenCalled();
        expect(telegram.sendFile.mock.calls[0][1].file.kind).toBe("big-file");
    });
    it("stops before sending another part when cancelled", async () => {
        const abort = new AbortController();
        telegram.invoke.mockImplementation(async () => {
            abort.abort();
            return true;
        });
        await expect(
            uploadFile("cancel", file(1024 * 1024), { signal: abort.signal }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(telegram.invoke).toHaveBeenCalledTimes(1);
        expect(telegram.sendFile).not.toHaveBeenCalled();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
    it("cleans progress and never creates a message after a failed file part", async () => {
        telegram.invoke.mockRejectedValue(new Error("Network unavailable"));
        await expect(uploadFile("fail", file())).rejects.toThrow(
            "Network unavailable",
        );
        expect(telegram.sendFile).not.toHaveBeenCalled();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
});

describe("streamed and fallback downloads", () => {
    it("keeps the filename and cleans the object URL and anchor", async () => {
        let name;
        HTMLAnchorElement.prototype.click.mockImplementation(function () {
            name = this.download;
        });
        await downloadFile("download", 55, "original name.txt");
        expect(name).toBe("original name.txt");
        expect(URL.createObjectURL.mock.calls[0][0].size).toBe(5);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:verification");
        expect(document.querySelector("a[download]")).toBeNull();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
    it("rejects missing files without leaving progress", async () => {
        telegram.getMessages.mockResolvedValue([]);
        await expect(
            downloadFile("missing", 55, "missing.txt"),
        ).rejects.toThrow("no longer available");
        expect(telegram.iterDownload).not.toHaveBeenCalled();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
    it("streams a large file without creating a Blob and opens the picker before network awaits", async () => {
        const order = [],
            writer = {
                write: vi.fn().mockResolvedValue(undefined),
                close: vi.fn().mockResolvedValue(undefined),
                abort: vi.fn().mockResolvedValue(undefined),
            };
        window.showSaveFilePicker = vi.fn(async () => {
            order.push("picker");
            return { createWritable: async () => writer };
        });
        telegram.getMessages.mockImplementation(async () => {
            order.push("lookup");
            return [documentMessage(streamingThreshold)];
        });
        const part = new Uint8Array(512 * 1024);
        telegram.iterDownload.mockReturnValue({
            async *[Symbol.asyncIterator]() {
                for (let i = 0; i < 128; i++) yield part;
            },
            close: vi.fn(),
        });
        await downloadFile("stream", 55, "large.bin", {
            size: streamingThreshold,
        });
        expect(order).toEqual(["picker", "lookup"]);
        expect(writer.write).toHaveBeenCalledTimes(128);
        expect(writer.close).toHaveBeenCalledOnce();
        expect(writer.abort).not.toHaveBeenCalled();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
    it("aborts the writable file and releases progress on cancellation", async () => {
        const abort = new AbortController(),
            writer = {
                write: vi.fn(async () => abort.abort()),
                close: vi.fn(),
                abort: vi.fn(),
            };
        window.showSaveFilePicker = vi.fn(async () => ({
            createWritable: async () => writer,
        }));
        telegram.getMessages.mockResolvedValue([
            documentMessage(streamingThreshold),
        ]);
        await expect(
            downloadFile("cancel", 55, "large.bin", {
                size: streamingThreshold,
                signal: abort.signal,
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(writer.abort).toHaveBeenCalledOnce();
        expect(writer.close).not.toHaveBeenCalled();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
    it("rejects truncated downloads instead of saving corrupt files", async () => {
        telegram.iterDownload.mockReturnValue(chunks([new Uint8Array(2)]));
        await expect(
            downloadFile("partial", 55, "partial.txt"),
        ).rejects.toThrow("incomplete");
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(Store.getState().progress.activeProgress).toEqual([]);
    });
    it("allows an empty document and cancels before lookup if already aborted", async () => {
        telegram.getMessages.mockResolvedValue([documentMessage(0)]);
        telegram.iterDownload.mockReturnValue(chunks([]));
        await downloadFile("empty", 55, "empty.txt");
        expect(URL.createObjectURL.mock.calls[0][0].size).toBe(0);
        const abort = new AbortController();
        abort.abort();
        telegram.getMessages.mockClear();
        await expect(
            downloadFile("aborted", 55, "empty.txt", { signal: abort.signal }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(telegram.getMessages).not.toHaveBeenCalled();
    });
});
