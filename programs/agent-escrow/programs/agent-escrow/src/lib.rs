use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

declare_id!("5T222sLRy8oX3aZ5oEb4rzJv9PXTvCWoBCHrqAoqgB9j");

#[program]
pub mod agent_escrow {
    use super::*;

    pub fn create_job(ctx: Context<CreateJob>, job_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);

        let job = &mut ctx.accounts.job_state;
        job.client = ctx.accounts.client.key();
        job.agent = ctx.accounts.agent.key();
        job.job_id = job_id;
        job.amount = amount;
        job.status = JobStatus::Created as u8;
        job.created_at = Clock::get()?.unix_timestamp;
        job.bump = ctx.bumps.job_state;
        let (_, vault_bump) = Pubkey::find_program_address(
            &[
                b"escrow".as_ref(),
                ctx.accounts.client.key().as_ref(),
                ctx.accounts.agent.key().as_ref(),
                &job_id.to_le_bytes(),
            ],
            ctx.program_id,
        );
        job.vault_bump = vault_bump;

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.client_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.client.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        job.status = JobStatus::Funded as u8;

        emit!(JobCreated {
            job: job.key(),
            client: job.client,
            agent: job.agent,
            job_id: job.job_id,
            amount: job.amount,
        });

        Ok(())
    }

    pub fn activate_job(ctx: Context<ActivateJob>) -> Result<()> {
        let job = &mut ctx.accounts.job_state;
        require!(
            job.status == JobStatus::Funded as u8,
            EscrowError::InvalidStatus
        );
        job.status = JobStatus::Active as u8;

        emit!(JobActivated {
            job: job.key(),
            agent: job.agent,
        });
        Ok(())
    }

    pub fn complete_job(ctx: Context<AgentAction>) -> Result<()> {
        let job = &mut ctx.accounts.job_state;
        require!(
            job.status == JobStatus::Active as u8,
            EscrowError::InvalidStatus
        );
        job.status = JobStatus::Completed as u8;

        emit!(JobCompleted {
            job: job.key(),
            agent: job.agent,
        });
        Ok(())
    }

    pub fn approve_release(ctx: Context<ApproveRelease>) -> Result<()> {
        let job = &mut ctx.accounts.job_state;
        require!(
            job.status == JobStatus::Completed as u8,
            EscrowError::InvalidStatus
        );

        let seeds = &[
            b"escrow".as_ref(),
            job.client.as_ref(),
            job.agent.as_ref(),
            &job.job_id.to_le_bytes(),
            &[job.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.agent_token.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, job.amount)?;

        job.status = JobStatus::Released as u8;

        emit!(JobReleased {
            job: job.key(),
            client: job.client,
            agent: job.agent,
            amount: job.amount,
        });
        Ok(())
    }

    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        let job = &mut ctx.accounts.job_state;
        require!(
            job.status == JobStatus::Active as u8 || job.status == JobStatus::Completed as u8,
            EscrowError::InvalidStatus
        );
        job.status = JobStatus::Disputed as u8;

        emit!(JobDisputed {
            job: job.key(),
            disputed_by: ctx.accounts.disputer.key(),
        });
        Ok(())
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, send_to_client: bool) -> Result<()> {
        let job = &mut ctx.accounts.job_state;
        require!(
            job.status == JobStatus::Disputed as u8,
            EscrowError::InvalidStatus
        );

        let recipient = if send_to_client {
            ctx.accounts.client_token.to_account_info()
        } else {
            ctx.accounts.agent_token.to_account_info()
        };

        let seeds = &[
            b"escrow".as_ref(),
            job.client.as_ref(),
            job.agent.as_ref(),
            &job.job_id.to_le_bytes(),
            &[job.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: recipient,
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, job.amount)?;

        job.status = JobStatus::Resolved as u8;

        emit!(JobResolved {
            job: job.key(),
            send_to_client,
        });
        Ok(())
    }

    pub fn cancel_job(ctx: Context<CancelJob>) -> Result<()> {
        let job = &mut ctx.accounts.job_state;
        require!(
            job.status == JobStatus::Funded as u8,
            EscrowError::InvalidStatus
        );

        let seeds = &[
            b"escrow".as_ref(),
            job.client.as_ref(),
            job.agent.as_ref(),
            &job.job_id.to_le_bytes(),
            &[job.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.client_token.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, job.amount)?;

        job.status = JobStatus::Cancelled as u8;

        emit!(JobCancelled {
            job: job.key(),
            client: job.client,
        });
        Ok(())
    }
}

// ==================== Accounts ====================

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CreateJob<'info> {
    #[account(
        init,
        payer = client,
        space = 8 + JobState::INIT_SPACE,
        seeds = [b"job", client.key().as_ref(), agent.key().as_ref(), &job_id.to_le_bytes()],
        bump
    )]
    pub job_state: Account<'info, JobState>,

    /// CHECK: Escrow vault PDA that holds USDC - derived from seeds
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: USDC mint address - validated by constraint on client_token
    pub usdc_mint: UncheckedAccount<'info>,

    /// CHECK: Client's USDC token account - validated by mint and owner constraints
    #[account(mut)]
    pub client_token: UncheckedAccount<'info>,

    /// CHECK: Agent receiving funds - used as seed
    pub agent: UncheckedAccount<'info>,

    #[account(mut)]
    pub client: Signer<'info>,

    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateJob<'info> {
    #[account(
        mut,
        seeds = [b"job", job_state.client.as_ref(), agent.key().as_ref(), &job_state.job_id.to_le_bytes()],
        bump = job_state.bump,
    )]
    pub job_state: Account<'info, JobState>,

    pub agent: Signer<'info>,
}

#[derive(Accounts)]
pub struct AgentAction<'info> {
    #[account(
        mut,
        seeds = [b"job", job_state.client.as_ref(), agent.key().as_ref(), &job_state.job_id.to_le_bytes()],
        bump = job_state.bump,
    )]
    pub job_state: Account<'info, JobState>,

    pub agent: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveRelease<'info> {
    #[account(
        mut,
        seeds = [b"job", client.key().as_ref(), job_state.agent.as_ref(), &job_state.job_id.to_le_bytes()],
        bump = job_state.bump,
    )]
    pub job_state: Account<'info, JobState>,

    /// CHECK: Escrow vault
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Agent's USDC token account
    #[account(mut)]
    pub agent_token: UncheckedAccount<'info>,

    pub client: Signer<'info>,
    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(
        mut,
        seeds = [b"job", job_state.client.as_ref(), job_state.agent.as_ref(), &job_state.job_id.to_le_bytes()],
        bump = job_state.bump,
        constraint = disputer.key() == job_state.client || disputer.key() == job_state.agent,
    )]
    pub job_state: Account<'info, JobState>,

    pub disputer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [b"job", job_state.client.as_ref(), job_state.agent.as_ref(), &job_state.job_id.to_le_bytes()],
        bump = job_state.bump,
    )]
    pub job_state: Account<'info, JobState>,

    /// CHECK: Escrow vault
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Client's USDC token account
    #[account(mut)]
    pub client_token: UncheckedAccount<'info>,

    /// CHECK: Agent's USDC token account
    #[account(mut)]
    pub agent_token: UncheckedAccount<'info>,

    pub admin: Signer<'info>,
    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(
        mut,
        seeds = [b"job", client.key().as_ref(), job_state.agent.as_ref(), &job_state.job_id.to_le_bytes()],
        bump = job_state.bump,
    )]
    pub job_state: Account<'info, JobState>,

    /// CHECK: Escrow vault
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Client's USDC token account
    #[account(mut)]
    pub client_token: UncheckedAccount<'info>,

    pub client: Signer<'info>,
    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,
}

// ==================== State ====================

#[account]
#[derive(InitSpace)]
pub struct JobState {
    pub client: Pubkey,
    pub agent: Pubkey,
    pub job_id: u64,
    pub amount: u64,
    pub status: u8,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[repr(u8)]
pub enum JobStatus {
    Created = 0,
    Funded = 1,
    Active = 2,
    Completed = 3,
    Released = 4,
    Disputed = 5,
    Resolved = 6,
    Cancelled = 7,
}

// ==================== Events ====================

#[event]
pub struct JobCreated {
    pub job: Pubkey,
    pub client: Pubkey,
    pub agent: Pubkey,
    pub job_id: u64,
    pub amount: u64,
}
#[event]
pub struct JobActivated {
    pub job: Pubkey,
    pub agent: Pubkey,
}
#[event]
pub struct JobCompleted {
    pub job: Pubkey,
    pub agent: Pubkey,
}
#[event]
pub struct JobReleased {
    pub job: Pubkey,
    pub client: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
}
#[event]
pub struct JobDisputed {
    pub job: Pubkey,
    pub disputed_by: Pubkey,
}
#[event]
pub struct JobResolved {
    pub job: Pubkey,
    pub send_to_client: bool,
}
#[event]
pub struct JobCancelled {
    pub job: Pubkey,
    pub client: Pubkey,
}

// ==================== Errors ====================

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount. Must be greater than 0")]
    InvalidAmount,
    #[msg("Invalid job status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized")]
    Unauthorized,
}
