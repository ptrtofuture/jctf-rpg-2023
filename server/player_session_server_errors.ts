export const SESSION_ERROR_IP_LIMIT = 'IP_LIMIT';

export class SessionError extends Error {
    code: string;

    constructor(code: string) {
        super(code);
        this.code = code;
    }
}
