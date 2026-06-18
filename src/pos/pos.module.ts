import { Module }            from '@nestjs/common';
import { TypeOrmModule }     from '@nestjs/typeorm';
import { NotificationsModule }  from '../notifications/notifications.module';
import { AiGovernanceModule }   from '../ai-governance/ai-governance.module';
import { PosShift }          from './entities/pos-shift.entity';
import { PosTransaction }    from './entities/pos-transaction.entity';
import { PosTransactionItem} from './entities/pos-transaction-item.entity';
import { PosCashMovement }   from './entities/pos-cash-movement.entity';
import { PosCustomer }          from './entities/pos-customer.entity';
import { PosInsuranceCompany }   from './entities/pos-insurance-company.entity';
import { PosService }                  from './pos.service';
import { PosController }               from './pos.controller';
import { PosIntegrityMonitorCron }     from './pos-integrity-monitor.cron';
import { MissedDemandService }         from '../inventory/missed-demand.service';

@Module({
  imports: [
    NotificationsModule,
    AiGovernanceModule,
    TypeOrmModule.forFeature([
      PosShift, PosTransaction, PosTransactionItem,
      PosCashMovement, PosCustomer, PosInsuranceCompany,
    ]),
  ],
  providers:   [PosService, PosIntegrityMonitorCron, MissedDemandService],
  controllers: [PosController],
  exports:     [PosService],
})
export class PosModule {}
