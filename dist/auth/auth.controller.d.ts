import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(dto: RegisterDto): Promise<{
        user: Partial<import("./entities/user.entity").User>;
        message: string;
    }>;
    getMe(user: any): Promise<import("./entities/user.entity").User>;
}
