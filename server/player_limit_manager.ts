export class PlayerLimitManager {
    private slots: number;
    private limit: number;

    constructor(limit: number) {
        this.slots = limit;
        this.limit = limit;
    }

    startSession(): boolean {
        if (this.slots === 0)
            return false;
        this.slots--;
        return true;
    }

    endSession(): void {
        this.slots++;
    }
}
