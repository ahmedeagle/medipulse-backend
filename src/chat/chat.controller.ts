import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle }       from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard }  from '../common/guards/jwt-auth.guard';
import { RolesGuard }    from '../common/guards/roles.guard';
import { Roles }         from '../common/decorators/roles.decorator';
import { CurrentUser }   from '../common/decorators/current-user.decorator';
import { Role }          from '../common/enums/role.enum';
import { AskChatDto, ChatExecuteDto } from './dto/ask-chat.dto';
import { ChatService }   from './chat.service';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pharmacy/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('ask')
  @HttpCode(200)
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask the AI assistant a natural-language question about your pharmacy' })
  ask(
    @CurrentUser() user: { tenantId: string | null; role: Role },
    @Body() dto: AskChatDto,
  ) {
    if (!user.tenantId) {
      throw new UnauthorizedException(
        'tenantId claim missing from token — ensure Keycloak protocol mapper is configured',
      );
    }
    return this.chatService.ask(user.tenantId, dto);
  }

  @Post('execute')
  @HttpCode(200)
  @Roles(Role.PHARMACY_ADMIN, Role.CHAIN_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Execute an AI action (creates approval records for review)' })
  execute(
    @CurrentUser() user: { tenantId: string | null; role: Role },
    @Body() dto: ChatExecuteDto,
  ) {
    if (!user.tenantId) {
      throw new UnauthorizedException(
        'tenantId claim missing from token — ensure Keycloak protocol mapper is configured',
      );
    }
    return this.chatService.execute(user.tenantId, dto);
  }
}
